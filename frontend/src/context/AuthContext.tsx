import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, AUTH_EXPIRED_EVENT } from "../api";
import type { AuthUser } from "../types";

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True until the server has said whether there is a session, so the login form is not flashed at a signed-in user. */
  checking: boolean;
  /** Resolves to an error message to show, or null once signed in. */
  login: (email: string, password: string, remember?: boolean) => Promise<string | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  checking: false,
  login: async () => "Not available",
  logout: async () => {},
});

// An older build kept a client-side "session" here. The server's cookie replaced it; drop the leftover.
const LEGACY_KEY = "intelligence_platform_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* storage may be blocked */
    }
    let alive = true;
    api.auth
      .me()
      .then((me) => alive && setUser(me))
      .catch(() => alive && setUser(null)) // 401: nobody is signed in
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, []);

  // Any request answered 401 means the session ended (expired, signed out elsewhere): back to the login form.
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    try {
      setUser(await api.auth.login(email.trim(), password, remember));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* the cookie is cleared or already gone: either way the user is out */
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, checking, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
