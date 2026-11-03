import { createContext, useContext, useState, type ReactNode } from "react";

interface User {
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  /** `remember` keeps the session for 30 days; otherwise it expires after 8 hours. */
  login: (email: string, password?: string, remember?: boolean) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  login: () => false,
  logout: () => {},
});

const AUTH_STORAGE_KEY = "intelligence_platform_user";
const HOUR = 60 * 60 * 1000;

// Stored in localStorage (not sessionStorage) so agent workspaces opened in a new tab share the session.
function readSaved(): User | null {
  try {
    const saved = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed.expires && parsed.expires < Date.now()) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return parsed.user ?? parsed; // older entries stored the bare user
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(readSaved);

  const login = (email: string, _password?: string, remember = true) => {
    if (!email || !email.trim()) return false;
    const cleanEmail = email.trim();
    const displayName = cleanEmail.split("@")[0]
      .replace(/[._-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "Admin";

    const authenticatedUser: User = {
      email: cleanEmail,
      name: displayName,
      role: "Operations Dispatcher",
    };

    setUser(authenticatedUser);
    try {
      const expires = Date.now() + (remember ? 30 * 24 : 8) * HOUR;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: authenticatedUser, expires }));
    } catch {
      // ignore storage errors
    }
    return true;
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
