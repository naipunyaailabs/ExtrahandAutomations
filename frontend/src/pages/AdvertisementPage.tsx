import { motion } from "framer-motion";
import { itemVariants, Stagger } from "../components/motion";
import { AdvertisementView } from "../components/AdvertisementView";

export default function AdvertisementPage({ mode = "dashboard" }: { mode?: "dashboard" | "regions" }) {
  return (
    <Stagger className="page">
      <motion.div variants={itemVariants}>
        <AdvertisementView mode={mode} />
      </motion.div>
    </Stagger>
  );
}

