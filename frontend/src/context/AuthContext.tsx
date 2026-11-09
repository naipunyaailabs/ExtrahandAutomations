import { createContext, useContext, useState, type ReactNode } from "react";
import { request } from "../api";

interface User {
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  /** Checks the credentials with the backend (ADMIN_EMAIL / ADMIN_PASSWORD in backend/.env). */
  login: (email: string, password: string, remember?: boolean) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  login: async () => "Not ready",
  logout: () => {},
});

const AUTH_STORAGE_KEY = "intelligence_platform_user";

interface SavedSession {
  user: User;
  token: string;
  expires: number;
}

// Stored in localStorage (not sessionStorage) so agent workspaces opened in a new tab share the session.
function readSaved(): SavedSession | null {
  try {
    const saved = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!parsed.token || !parsed.expires || parsed.expires < Date.now()) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return parsed as SavedSession;
  } catch {
    return null;
  }
}

/** Bearer token for API calls, or null when signed out. */
export function authToken(): string | null {
  return readSaved()?.token ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readSaved()?.user ?? null);

  const login = async (email: string, password: string, remember = true): Promise<string | null> => {
    try {
      const data = await request<{ token: string; expires: number; user: User }>("POST", "/api/auth/login", {
        email: email.trim(),
        password,
        remember,
      });
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: data.user, token: data.token, expires: data.expires }));
      } catch {
        // ignore storage errors
      }
      setUser(data.user);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Sign-in failed.";
    }
  };

  const logout = () => {
    setUser(null);
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
