import { motion } from "framer-motion";
import { itemVariants, Stagger } from "../components/motion";
import { AdvertisementView } from "../components/AdvertisementView";

export default function AdvertisementPage() {
  return (
    <Stagger className="page">
      <motion.div variants={itemVariants}>
        <AdvertisementView />
      </motion.div>
    </Stagger>
  );
}

