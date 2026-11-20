import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, AUTH_EXPIRED_EVENT, getSessionToken, setSessionToken } from "../api";
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

const SESSION_STORAGE_KEY = "extrahand_auth_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
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
      .then((me) => {
        if (alive) {
          if (me.token) setSessionToken(me.token);
          try {
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(me));
          } catch {}
          setUser(me);
        }
      })
      .catch((err) => {
        if (alive) {
          const msg = (err as Error)?.message || "";
          if (msg.includes("401") || !getSessionToken()) {
            setSessionToken(null);
            try {
              sessionStorage.removeItem(SESSION_STORAGE_KEY);
            } catch {}
            setUser(null);
          }
        }
      })
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, []);

  // Any request answered 401 means the session ended (expired, signed out elsewhere): back to the login form.
  useEffect(() => {
    const expired = () => {
      setSessionToken(null);
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {}
      setUser(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    try {
      const u = await api.auth.login(email.trim(), password, remember);
      if (u.token) {
        setSessionToken(u.token);
      }
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(u));
      } catch {}
      setUser(u);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  const logout = useCallback(async () => {
    setSessionToken(null);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {}
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
