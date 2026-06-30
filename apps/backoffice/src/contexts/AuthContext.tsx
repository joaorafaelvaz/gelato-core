import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LoginResponse } from '../lib/api';

type AuthContextType = {
  user: LoginResponse['user'] | null;
  token: string | null;
  setAuth: (res: LoginResponse) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LoginResponse['user'] | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('gelato_token');
    const storedUser = localStorage.getItem('gelato_user');
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const setAuth = (res: LoginResponse) => {
    localStorage.setItem('gelato_token', res.accessToken);
    localStorage.setItem('gelato_user', JSON.stringify(res.user));
    setToken(res.accessToken);
    setUser(res.user);
  };

  const logout = () => {
    localStorage.removeItem('gelato_token');
    localStorage.removeItem('gelato_user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, setAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
