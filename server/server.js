const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());

const API_KEY = "fd516d674784408c87022df18db71ce6";
const BASE_URL = "https://api.football-data.org/v4";

// Endpoint: partidos por rango de fechas
app.get('/api/partidos', async (req, res) => {
  const { dateFrom, dateTo, competitions } = req.query;
  try {
    const resp = await fetch(
      `${BASE_URL}/matches?competitions=${competitions}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      { headers: { "X-Auth-Token": API_KEY } }
    );
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: estadisticas (ultimos partidos) de un equipo
app.get('/api/equipo/:id/stats', async (req, res) => {
  try {
    const resp = await fetch(
      `${BASE_URL}/teams/${req.params.id}/matches?status=FINISHED&limit=12`,
      { headers: { "X-Auth-Token": API_KEY } }
    );
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de fulbito corriendo en el puerto ${PORT}`);
});