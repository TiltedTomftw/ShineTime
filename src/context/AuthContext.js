import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const ACTIVE_DEALERSHIP_KEY = '@detailtracker_active_dealership_id';
const LEGACY_DETAILER_NAME_KEY = '@detailtracker_detailer_name';
const ACTIVE_OPERATIONAL_ROLE_PREFIX = '@detailtracker_active_operational_role';
// Stable per-person id (now the auth user id) used to attribute and scope jobs
// instead of a mutable free-text name. storage.js reads this key.
const ACTIVE_OPERATIONAL_USER_ID_KEY = '@detailtracker_active_operational_user_id';

const AuthContext = React.createContext(null);

const sanitizeName = (value) =>
  (value || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, 50);

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
  const activeOperationalRole = activeDealership
    ? membershipRoleToOperational(activeDealership.role)
    : '';

  const resetUserState = React.useCallback(async () => {
    bootstrapUserIdRef.current = null;
    setProfile(null);
    setMemberships([]);
    setActiveDealership(null);
    setActiveOperationalUser(null);
    await AsyncStorage.removeItem(ACTIVE_DEALERSHIP_KEY);
    await AsyncStorage.removeItem(LEGACY_DETAILER_NAME_KEY);
    await AsyncStorage.removeItem(ACTIVE_OPERATIONAL_USER_ID_KEY);
  }, []);

  // The signed-in account IS the person now (employees each get their own via
  // the invite-code flow), so operational identity comes from the auth user
  // rather than a device-local name+PIN record. That makes the id stable across
  // devices and gives storage.js a real per-person id to attribute jobs to.
  const refreshOperationalState = React.useCallback(
    async (userId, dealershipId, membershipRole, displayName) => {
      if (!userId || !dealershipId) {
        setActiveOperationalUser(null);
        return;
      }

      // Persist the membership-derived operational role for storage.js job scoping.
      const operationalRole = membershipRoleToOperational(membershipRole);
      await AsyncStorage.setItem('@detailtracker_active_operational_role', operationalRole);

      const name = sanitizeName(displayName) || 'Unknown';
      const user = { id: userId, name, role: operationalRole };
      setActiveOperationalUser(user);

      // storage.js / jobLogic.jobBelongsToOperator read these keys unchanged.
      await AsyncStorage.setItem(LEGACY_DETAILER_NAME_KEY, name);
      await AsyncStorage.setItem(ACTIVE_OPERATIONAL_USER_ID_KEY, userId);
    },
    [],
  );

  const loadMemberships = React.useCallback(
    async (userId, displayName) => {
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
        await refreshOperationalState(userId, saved.dealershipId, saved.role, displayName);
        return;
      }

      if (normalized.length === 1) {
        await AsyncStorage.setItem(ACTIVE_DEALERSHIP_KEY, normalized[0].dealershipId);
        setActiveDealership(normalized[0]);
        await refreshOperationalState(
          userId,
          normalized[0].dealershipId,
          normalized[0].role,
          displayName,
        );
        return;
      }

      setActiveDealership(null);
      setActiveOperationalUser(null);
    },
    [refreshOperationalState],
  );

  const ensureProfile = React.useCallback(async (user) => {
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, full_name, created_at, updated_at')
      .eq('user_id', user.id)
      .limit(1);

    if (profileError) throw profileError;

    let profileRow = data && data[0] ? data[0] : null;

    if (!profileRow) {
      const candidate =
        sanitizeName(user.user_metadata?.full_name) || inferNameFromEmail(user.email);
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
    return profileRow;
  }, []);

  // Display name for job attribution: the profile row, else the account's
  // metadata, else the email local part (for employees that's their name slug).
  const displayNameFor = (profileRow, user) =>
    sanitizeName(profileRow?.full_name) ||
    sanitizeName(user?.user_metadata?.full_name) ||
    inferNameFromEmail(user?.email) ||
    'Unknown';

  const bootstrapUser = React.useCallback(
    async (user) => {
      // Skip if we've already bootstrapped (or are bootstrapping) this user —
      // getSession() and the INITIAL_SESSION auth event both call this on launch.
      if (bootstrapUserIdRef.current === user.id) return;
      bootstrapUserIdRef.current = user.id;
      setLoadingUserData(true);
      setError('');
      try {
        const profileRow = await ensureProfile(user);
        await loadMemberships(user.id, displayNameFor(profileRow, user));
      } catch (e) {
        // Allow a retry on the next auth event if bootstrap failed.
        bootstrapUserIdRef.current = null;
        setError(e?.message || 'Failed to load account data');
      } finally {
        setLoadingUserData(false);
      }
    },
    [ensureProfile, loadMemberships],
  );

  React.useEffect(() => {
    let mounted = true;

    const init = async () => {
      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(initialSession);
      if (initialSession?.user) {
        await bootstrapUser(initialSession.user);
      }
      if (mounted) setInitializing(false);
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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

  const selectActiveDealership = React.useCallback(
    async (dealershipId) => {
      const selected = memberships.find((m) => m.dealershipId === dealershipId);
      if (!selected) throw new Error('Invalid dealership selection');

      setActiveDealership(selected);
      await AsyncStorage.setItem(ACTIVE_DEALERSHIP_KEY, selected.dealershipId);

      if (session?.user?.id) {
        await refreshOperationalState(
          session.user.id,
          selected.dealershipId,
          selected.role,
          displayNameFor(profile, session.user),
        );
      } else {
        setActiveOperationalUser(null);
      }
    },
    [memberships, refreshOperationalState, session?.user?.id, profile],
  );

  const value = React.useMemo(
    () => ({
      session,
      profile,
      memberships,
      activeDealership,
      activeOperationalRole,
      activeOperationalUser,
      isLoading: initializing || loadingUserData,
      error,
      signIn,
      signOut,
      selectActiveDealership,
      refreshMemberships: async () => {
        if (session?.user) {
          await loadMemberships(session.user.id, displayNameFor(profile, session.user));
        }
      },
    }),
    [
      session,
      profile,
      memberships,
      activeDealership,
      activeOperationalRole,
      activeOperationalUser,
      initializing,
      loadingUserData,
      error,
      signIn,
      signOut,
      selectActiveDealership,
      loadMemberships,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
