import { Router } from "express";
import { HealthController } from "../controllers/healthController";

const router = Router();
const controller = new HealthController();

router.get("/", (req, res) => controller.check(req, res));

export default router;
