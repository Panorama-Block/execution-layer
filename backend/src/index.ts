import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import swaggerDoc from "./docs/swagger.json";
import { swapProviderRoutes } from "./routes/swap-provider.routes";
import { stakingRoutes } from "./modules/liquid-staking/routes/staking.routes";
import { swapRoutes } from "./modules/swap/routes/swap.routes";
import { dcaRoutes } from "./modules/dca/routes/dca.routes";
import { errorHandler } from "./middleware/errorHandler";
import { rateLimiter } from "./middleware/rateLimiter";

const app = express();
const PORT = process.env.PORT || 3010;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "PanoramaBlock API Docs",
}));

app.use("/provider/swap", swapProviderRoutes); // External Liquid Swap Service adapter
app.use("/staking", stakingRoutes);
app.use("/swap", swapRoutes);
app.use("/dca", dcaRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "execution-service", port: PORT });
});

// Global error handler — must be registered AFTER routes
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`execution-service running on port ${PORT}`);
});

export default app;
