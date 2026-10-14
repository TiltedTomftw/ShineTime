// Who is signed in and where — set by AuthContext, read by the job services.
// Held in memory only; nothing here is written to the phone.

let context = { userId: null, userName: '', dealershipId: null, role: '' };

export const setSessionContext = (next) => {
  context = { userId: null, userName: '', dealershipId: null, role: '', ...next };
};

export const clearSessionContext = () => setSessionContext({});

export const getSessionContext = () => context;

export const requireSessionContext = () => {
  if (!context.userId || !context.dealershipId) {
    throw new Error('Not signed in to a dealership.');
  }
  return context;
};
