import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { setSessionContext, clearSessionContext } from '../services/session';
import { startOutbox, stopOutbox } from '../services/outbox';
import { clearJobsMemory, migrateLegacyStorage } from '../services/jobs';

// The only thing about the account kept on the phone besides Supabase's own
// session: which dealership was picked last, for people with more than one.
const ACTIVE_DEALERSHIP_KEY = '@detailtracker_active_dealership_id';

const AuthContext = React.createContext(null);

const sanitizeName = (value) =>
  (value || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, 50);

const inferNameFromEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  return (email.split('@')[0] || '').slice(0, 50);
};

// Owners operate as managers in the app.
const membershipRoleToOperational = (role) => {
  const r = (role || '').toLowerCase();
  return r === 'owner' ? 'manager' : r;
};

const displayNameFor = (profileRow, user) =>
  sanitizeName(profileRow?.full_name) ||
  sanitizeName(user?.user_metadata?.full_name) ||
  inferNameFromEmail(user?.email) ||
  'Unknown';

export function AuthProvider({ children }) {
  const [session, setSession] = React.useState(null);
  const [profile, setProfile] = React.useState(null);
  const [memberships, setMemberships] = React.useState([]);
  const [activeDealership, setActiveDealership] = React.useState(null);
  const [initializing, setInitializing] = React.useState(true);
  const [loadingUserData, setLoadingUserData] = React.useState(false);
  // Set when the account couldn't be loaded (no signal, server trouble). The
  // gate shows a Retry screen instead of guessing the person has no dealership.
  const [loadError, setLoadError] = React.useState('');
  const bootstrapUserIdRef = React.useRef(null);

  const activeOperationalRole = activeDealership
    ? membershipRoleToOperational(activeDealership.role)
    : '';
  const userName = displayNameFor(profile, session?.user);

  // Point the job services at the active person + dealership. Screens wait for
  // `servicesReady` (child effects run before this parent effect, so without
  // the flag a screen could query before the context is set).
  const [readyKey, setReadyKey] = React.useState('');
  const userId = session?.user?.id;
  const contextKey = userId && activeDealership ? `${userId}:${activeDealership.dealershipId}` : '';
  React.useEffect(() => {
    let cancelled = false;
    if (!contextKey) {
      clearSessionContext();
      return undefined;
    }
    setSessionContext({
      userId,
      userName,
      dealershipId: activeDealership.dealershipId,
      role: activeOperationalRole,
    });
    startOutbox(userId)
      .catch(() => {})
      .then(() => {
        if (!cancelled) setReadyKey(contextKey);
        return migrateLegacyStorage();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contextKey, userId, activeDealership, activeOperationalRole, userName]);
  const servicesReady = !!contextKey && readyKey === contextKey;

  const resetUserState = React.useCallback(async () => {
    bootstrapUserIdRef.current = null;
    setProfile(null);
    setMemberships([]);
    setActiveDealership(null);
    setLoadError('');
    clearSessionContext();
    clearJobsMemory();
    await AsyncStorage.removeItem(ACTIVE_DEALERSHIP_KEY);
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
    } else if (normalized.length === 1) {
      await AsyncStorage.setItem(ACTIVE_DEALERSHIP_KEY, normalized[0].dealershipId);
      setActiveDealership(normalized[0]);
    } else {
      setActiveDealership(null);
    }
  }, []);

  const ensureProfile = React.useCallback(async (user) => {
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .eq('user_id', user.id)
      .limit(1);
    if (profileError) throw profileError;

    let profileRow = data && data[0] ? data[0] : null;
    if (!profileRow) {
      const candidate =
        sanitizeName(user.user_metadata?.full_name) || inferNameFromEmail(user.email);
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .upsert({ user_id: user.id, full_name: candidate || null }, { onConflict: 'user_id' })
        .select('user_id, full_name')
        .single();
      if (insertError) throw insertError;
      profileRow = inserted;
    }
    setProfile(profileRow);
    return profileRow;
  }, []);

  const bootstrapUser = React.useCallback(
    async (user) => {
      // getSession() and the INITIAL_SESSION event both fire on launch.
      if (bootstrapUserIdRef.current === user.id) return;
      bootstrapUserIdRef.current = user.id;
      setLoadingUserData(true);
      setLoadError('');
      try {
        await ensureProfile(user);
        await loadMemberships(user.id);
      } catch (e) {
        bootstrapUserIdRef.current = null; // allow Retry
        setLoadError(e?.message || 'Could not load your account.');
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
      if (initialSession?.user) await bootstrapUser(initialSession.user);
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

  const sessionUser = session?.user || null;
  const retryLoad = React.useCallback(async () => {
    if (sessionUser) await bootstrapUser(sessionUser);
  }, [sessionUser, bootstrapUser]);

  const signOut = React.useCallback(async () => {
    await stopOutbox(); // deletes this person's unsent actions + photo files
    await supabase.auth.signOut();
    await resetUserState();
  }, [resetUserState]);

  const selectActiveDealership = React.useCallback(
    async (dealershipId) => {
      const selected = memberships.find((m) => m.dealershipId === dealershipId);
      if (!selected) throw new Error('Invalid dealership selection');
      clearJobsMemory();
      setActiveDealership(selected);
      await AsyncStorage.setItem(ACTIVE_DEALERSHIP_KEY, selected.dealershipId);
    },
    [memberships],
  );

  const switchDealership = React.useCallback(async () => {
    clearJobsMemory();
    setActiveDealership(null);
    await AsyncStorage.removeItem(ACTIVE_DEALERSHIP_KEY);
  }, []);

  const refreshMemberships = React.useCallback(async () => {
    if (sessionUser) await loadMemberships(sessionUser.id);
  }, [sessionUser, loadMemberships]);

  const value = React.useMemo(
    () => ({
      session,
      profile,
      userName,
      memberships,
      activeDealership,
      activeOperationalRole,
      isManager: activeOperationalRole === 'manager',
      isLoading: initializing || loadingUserData,
      servicesReady,
      loadError,
      retryLoad,
      signOut,
      selectActiveDealership,
      switchDealership,
      refreshMemberships,
    }),
    [
      session,
      profile,
      userName,
      memberships,
      activeDealership,
      activeOperationalRole,
      initializing,
      loadingUserData,
      servicesReady,
      loadError,
      retryLoad,
      signOut,
      selectActiveDealership,
      switchDealership,
      refreshMemberships,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
