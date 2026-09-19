import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import api from '../services/api';

interface AuthState {
  username: string | null;
  role: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    username: null,
    role: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const checkAuth = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setState({
        username: res.data.username,
        role: res.data.role,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      setState({ username: null, role: null, isAuthenticated: false, isLoading: false });
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const login = async (username: string, password: string) => {
    try {
      const res = await api.post('/auth/login', { username, password });
      const token = res.data.token;
      // Store token in localStorage for API requests
      localStorage.setItem('auth_token', token);
      setState({ username: res.data.username, role: res.data.role, isAuthenticated: true, isLoading: false });
      return { success: true };
    } catch (err: any) {
      const message = err?.response?.data?.message || 'Login failed';
      return { success: false, message };
    }
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    localStorage.removeItem('auth_token');
    setState({ username: null, role: null, isAuthenticated: false, isLoading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}