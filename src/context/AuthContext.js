import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const ACTIVE_DEALERSHIP_KEY = '@detailtracker_active_dealership_id';
const LEGACY_DETAILER_NAME_KEY = '@detailtracker_detailer_name';
const ACTIVE_OPERATIONAL_ROLE_PREFIX = '@detailtracker_active_operational_role';
const ACTIVE_OPERATIONAL_USER_PREFIX = '@detailtracker_active_operational_user';
const DEALERSHIP_USERS_PREFIX = '@detailtracker_dealership_users';

const AuthContext = React.createContext(null);

const sanitizeName = (value) => (value || '').trim().replace(/<[^>]*>/g, '').slice(0, 50);

const inferNameFromEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  const local = email.split('@')[0] || '';
  return local.slice(0, 50);
};

// Operational role comes from the membership (manager-assigned via invite codes /
// ownership), never self-selected. Owners operate as managers in the app.
const membershipRoleToOperational = (role) => {
  const r = (role || '').toLowerCase();
  return r === 'owner' ? 'manager' : r;
};

const getOperationalUserKey = (userId, dealershipId) => `${ACTIVE_OPERATIONAL_USER_PREFIX}:${userId}:${dealershipId}`;
const getDealershipUsersKey = (dealershipId) => `${DEALERSHIP_USERS_PREFIX}:${dealershipId}`;

// PINs are verified server-side against a bcrypt hash (see migration 005). Older
// builds kept a roster of cleartext PINs on the device; wipe any that remain.
const purgeLegacyPinRoster = async (dealershipId) => {
  await AsyncStorage.removeItem(getDealershipUsersKey(dealershipId));
};

export function AuthProvider({ children }) {
  const [session, setSession] = React.useState(null);
  const [profile, setProfile] = React.useState(null);
  const [memberships, setMemberships] = React.useState([]);
  const [activeDealership, setActiveDealership] = React.useState(null);
  const [activeOperationalUser, setActiveOperationalUser] = React.useState(null);
  const [initializing, setInitializing] = React.useState(true);
  const [loadingUserData, setLoadingUserData] = React.useState(false);
  const [error, setError] = React.useState('');
  // Tracks which user we've already bootstrapped so init() and
  // onAuthStateChange (which both fire on launch) don't double-bootstrap.
  const bootstrapUserIdRef = React.useRef(null);

  // Role is derived from the active membership (manager-assigned), not chosen.
  const activeOperationalRole = activeDealership ? membershipRoleToOperational(activeDealership.role) : '';

  const hasCompletedDetailerSetup = Boolean(activeOperationalRole && activeOperationalUser?.name);

  const resetUserState = React.useCallback(async () => {
    bootstrapUserIdRef.current = null;
    setProfile(null);
    setMemberships([]);
    setActiveDealership(null);
    setActiveOperationalUser(null);
    await AsyncStorage.removeItem(ACTIVE_DEALERSHIP_KEY);
    await AsyncStorage.removeItem(LEGACY_DETAILER_NAME_KEY);
  }, []);

  const refreshOperationalState = React.useCallback(async (userId, dealershipId, membershipRole) => {
    if (!userId || !dealershipId) {
      setActiveOperationalUser(null);
      return;
    }

    // Persist the membership-derived operational role for storage.js job scoping.
    const operationalRole = membershipRoleToOperational(membershipRole);
    await AsyncStorage.setItem('@detailtracker_active_operational_role', operationalRole);

    await purgeLegacyPinRoster(dealershipId);

    const userKey = getOperationalUserKey(userId, dealershipId);
    const userRaw = await AsyncStorage.getItem(userKey);

    let user = null;
    if (userRaw) {
      try {
        user = JSON.parse(userRaw);
      } catch {
        user = null;
      }
    }

    // A cached user written by an older build carries a cleartext pin; drop it
    // and rewrite the record without one.
    if (user && 'pin' in user) {
      delete user.pin;
      await AsyncStorage.setItem(userKey, JSON.stringify(user));
    }

    setActiveOperationalUser(user && user.name ? user : null);
    if (user?.name) {
      await AsyncStorage.setItem(LEGACY_DETAILER_NAME_KEY, user.name);
    }
  }, []);

  const loadMemberships = React.useCallback(async (userId) => {
    const { data, error: membershipsError } = await supabase
      .from('dealership_memberships')
      .select('id, dealership_id, role, is_active, dealerships(id, name, slug)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (membershipsError) throw membershipsError;

    const normalized = (data || []).map((row) => ({
      id: row.id,
      dealershipId: row.dealership_id,
      role: row.role,
      isActive: row.is_active,
      dealership: Array.isArray(row.dealerships) ? row.dealerships[0] : row.dealerships,
    }));

    setMemberships(normalized);

    const savedDealershipId = await AsyncStorage.getItem(ACTIVE_DEALERSHIP_KEY);
    const saved = normalized.find((m) => m.dealershipId === savedDealershipId);

    if (saved) {
      setActiveDealership(saved);
      await refreshOperationalState(userId, saved.dealershipId, saved.role);
      return;
    }

    if (normalized.length === 1) {
      await AsyncStorage.setItem(ACTIVE_DEALERSHIP_KEY, normalized[0].dealershipId);
      setActiveDealership(normalized[0]);
      await refreshOperationalState(userId, normalized[0].dealershipId, normalized[0].role);
      return;
    }

    setActiveDealership(null);
    setActiveOperationalUser(null);
  }, [refreshOperationalState]);

  const ensureProfile = React.useCallback(async (user) => {
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, full_name, created_at, updated_at')
      .eq('user_id', user.id)
      .limit(1);

    if (profileError) throw profileError;

    let profileRow = data && data[0] ? data[0] : null;

    if (!profileRow) {
      const candidate = sanitizeName(user.user_metadata?.full_name) || inferNameFromEmail(user.email);
      const insertPayload = {
        user_id: user.id,
        full_name: candidate || null,
      };

      // Upsert (not insert) so a concurrent bootstrap racing on the same user
      // cannot fail with a primary-key unique violation.
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .upsert(insertPayload, { onConflict: 'user_id' })
        .select('user_id, full_name, created_at, updated_at')
        .single();

      if (insertError) throw insertError;
      profileRow = inserted;
    }

    setProfile(profileRow);
  }, []);

  const bootstrapUser = React.useCallback(async (user) => {
    // Skip if we've already bootstrapped (or are bootstrapping) this user —
    // getSession() and the INITIAL_SESSION auth event both call this on launch.
    if (bootstrapUserIdRef.current === user.id) return;
    bootstrapUserIdRef.current = user.id;
    setLoadingUserData(true);
    setError('');
    try {
      await ensureProfile(user);
      await loadMemberships(user.id);
    } catch (e) {
      // Allow a retry on the next auth event if bootstrap failed.
      bootstrapUserIdRef.current = null;
      setError(e?.message || 'Failed to load account data');
    } finally {
      setLoadingUserData(false);
    }
  }, [ensureProfile, loadMemberships]);

  React.useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(initialSession);
      if (initialSession?.user) {
        await bootstrapUser(initialSession.user);
      }
      if (mounted) setInitializing(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        bootstrapUser(nextSession.user);
      } else {
        resetUserState();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [bootstrapUser, resetUserState]);

  const signIn = React.useCallback(async (email, password) => {
    setError('');
    const response = await supabase.auth.signInWithPassword({ email, password });
    if (response.error) {
      setError(response.error.message);
    }
    return response;
  }, []);

  const signOut = React.useCallback(async () => {
    setError('');
    await supabase.auth.signOut();
    await resetUserState();
  }, [resetUserState]);

  const selectActiveDealership = React.useCallback(async (dealershipId) => {
    const selected = memberships.find((m) => m.dealershipId === dealershipId);
    if (!selected) throw new Error('Invalid dealership selection');

    setActiveDealership(selected);
    await AsyncStorage.setItem(ACTIVE_DEALERSHIP_KEY, selected.dealershipId);

    if (session?.user?.id) {
      await refreshOperationalState(session.user.id, selected.dealershipId, selected.role);
    } else {
      setActiveOperationalUser(null);
    }
  }, [memberships, refreshOperationalState, session?.user?.id]);

  const completeDealershipUserAccess = React.useCallback(async ({ mode, name, pin }) => {
    if (!session?.user?.id) throw new Error('Not authenticated');
    if (!activeDealership?.dealershipId) throw new Error('No active dealership selected');
    if (!activeOperationalRole) throw new Error('No role assigned for this dealership');

    const sanitizedName = sanitizeName(name);
    const normalizedPin = String(pin || '').trim();

    if (!sanitizedName) throw new Error('User name is required');
    if (normalizedPin.length < 4) throw new Error('PIN must be at least 4 digits');

    const dealershipId = activeDealership.dealershipId;
    const normalizedRole = activeOperationalRole.toLowerCase();

    // The PIN never leaves this call: it goes to the server, which compares it
    // against a bcrypt hash. Nothing below persists it.
    let operationalUserId;

    if (mode === 'create') {
      // Role is derived server-side from the caller's membership, so it is not
      // passed in here.
      const { data, error: enrollError } = await supabase.rpc('enroll_dealership_user', {
        p_dealership_id: dealershipId,
        p_name: sanitizedName,
        p_pin: normalizedPin,
      });
      if (enrollError) throw new Error(enrollError.message || 'Could not create user');
      operationalUserId = data;
    } else {
      const { data, error: verifyError } = await supabase.rpc('verify_dealership_user_pin', {
        p_dealership_id: dealershipId,
        p_name: sanitizedName,
        p_role: normalizedRole,
        p_pin: normalizedPin,
      });
      // A thrown error is the lockout (or an authz failure); a null result is
      // simply a bad name/PIN, kept deliberately indistinguishable.
      if (verifyError) throw new Error(verifyError.message || 'Login failed');
      if (!data) throw new Error('Incorrect name or PIN');
      operationalUserId = data;
    }

    const user = {
      id: operationalUserId,
      name: sanitizedName,
      role: normalizedRole,
      createdAt: Date.now(),
    };

    setActiveOperationalUser(user);
    await AsyncStorage.setItem(getOperationalUserKey(session.user.id, dealershipId), JSON.stringify(user));
    await AsyncStorage.setItem(LEGACY_DETAILER_NAME_KEY, user.name);
    return user;
  }, [session?.user?.id, activeDealership?.dealershipId, activeOperationalRole]);

  const value = React.useMemo(() => ({
    session,
    profile,
    memberships,
    activeDealership,
    activeOperationalRole,
    activeOperationalUser,
    hasCompletedDetailerSetup,
    isLoading: initializing || loadingUserData,
    error,
    signIn,
    signOut,
    selectActiveDealership,
    completeDealershipUserAccess,
    refreshMemberships: async () => {
      if (session?.user) {
        await loadMemberships(session.user.id);
      }
    },
  }), [session, profile, memberships, activeDealership, activeOperationalRole, activeOperationalUser, hasCompletedDetailerSetup, initializing, loadingUserData, error, signIn, signOut, selectActiveDealership, completeDealershipUserAccess, loadMemberships]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
