import { createContext, useContext, useState, type ReactNode } from 'react';

export interface PosContextValue {
  token: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    tenantId: string;
    betriebsstaetteIds: string[];
    permissions: string[];
  } | null;
  kasseId: string | null;
  setSession: (token: string, user: PosContextValue['user'], kasseId: string) => void;
  clearSession: () => void;
}

const PosContext = createContext<PosContextValue | null>(null);

export function PosProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PosContextValue['user']>(null);
  const [kasseId, setKasseId] = useState<string | null>(null);

  const setSession = (
    newToken: string,
    newUser: PosContextValue['user'],
    newKasseId: string,
  ) => {
    setToken(newToken);
    setUser(newUser);
    setKasseId(newKasseId);
  };

  const clearSession = () => {
    setToken(null);
    setUser(null);
    setKasseId(null);
  };

  return (
    <PosContext.Provider value={{ token, user, kasseId, setSession, clearSession }}>
      {children}
    </PosContext.Provider>
  );
}

export function usePos() {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePos must be used within PosProvider');
  return ctx;
}
