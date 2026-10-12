const path = require("path");

const packageRoot = path.resolve(
  __dirname,
  "..",
  "services",
  "personal-email-signup-backend",
);

function getTarget() {
  const rawUrl = process.env.PHASE1_DATABASE_URL;
  const provenance = process.env.PHASE1_DATABASE_PROVENANCE;
  if (!rawUrl) throw new Error("PHASE1_DATABASE_URL is required");
  if (!provenance || !["local-temporary", "ci-service"].includes(provenance)) {
    throw new Error(
      "PHASE1_DATABASE_PROVENANCE must be local-temporary or ci-service",
    );
  }
  const url = new URL(rawUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Phase 1 database operations require a loopback host");
  }
  if (!/^phase1_[a-z0-9_]+$/i.test(database)) {
    throw new Error("Phase 1 database name must be explicitly phase1-scoped");
  }
  return { rawUrl, database, provenance };
}

function prismaBinary() {
  return path.join(
    packageRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
}

function packageRootPath() {
  return packageRoot;
}

module.exports = { getTarget, packageRootPath, prismaBinary };
