import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon: Icon, loading, children, className = "", disabled, ...rest }: ButtonProps) {
  const off = disabled || loading;
  return (
    <motion.button
      className={`btn btn-${variant} btn-${size} ${className}`}
      whileHover={off ? undefined : { y: -1 }}
      whileTap={off ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={off}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={size === "sm" ? 13 : 15} /> : Icon && <Icon size={size === "sm" ? 13 : 15} />}
      {children}
    </motion.button>
  );
}
