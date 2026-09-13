import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import accountRouter from "./account";
import notesRouter from "./notes";
import audioRouter from "./audio";
import consultationsRouter from "./consultations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(accountRouter);
router.use(notesRouter);
router.use(audioRouter);
router.use(consultationsRouter);

export default router;
