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

// CORS — restrict to allowlisted origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:3000", "http://localhost:3010"];

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimiter);

// Swagger only in non-production environments
if (process.env.NODE_ENV !== "production") {
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "PanoramaBlock API Docs",
  }));
}

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
