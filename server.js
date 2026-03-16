const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);

const app = express();

app.use(express.static(__dirname));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`Draft tracker running on http://localhost:${PORT}`);
  });
}

module.exports = app;
