require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques
app.use(express.static('frames'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/frames/index.html');
});

// Route pour exécuter la query Dune
app.post('/api/evaluate', async (req, res) => {
  try {
    const { level, cm_type } = req.body;

    // Validation des paramètres
    if (!level || !cm_type) {
      return res.status(400).json({ 
        error: 'Missing parameters. Please provide level and cm_type' 
      });
    }

    console.log(`Evaluating Clankermon: Level ${level}, Type ${cm_type}`);

    // Appel à l'API Dune
    const duneResponse = await axios.post(
      'https://api.dune.com/api/v1/query/5733367/execute',
      {
        query_parameters: {
          level: level,
          cm_type: cm_type
        }
      },
      {
        headers: {
          'X-Dune-API-Key': process.env.DUNE_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const executionId = duneResponse.data.execution_id;
    console.log(`Execution ID: ${executionId}`);

    // Attendre que la query soit terminée
    let results = null;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Attendre 2 secondes

      const statusResponse = await axios.get(
        `https://api.dune.com/api/v1/execution/${executionId}/results`,
        {
          headers: {
            'X-Dune-API-Key': process.env.DUNE_API_KEY
          }
        }
      );

      if (statusResponse.data.state === 'QUERY_STATE_COMPLETED') {
        results = statusResponse.data.result.rows;
        break;
      }

      attempts++;
    }

    if (!results) {
      return res.status(408).json({ error: 'Query timeout. Please try again.' });
    }

    // Formater les résultats
    const formattedResults = {
      level: level,
      type: cm_type,
      valuations: results.map(row => ({
        category: row.category,
        usd_valuation: parseFloat(row.usd_valuation || 0).toFixed(2),
        eth_valuation: parseFloat(row.eth_valuation || 0).toFixed(6)
      })),
      donation_address: process.env.DONATION_ADDRESS || null
    };

    res.json(formattedResults);

  } catch (error) {
    console.error('Error evaluating Clankermon:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to evaluate Clankermon',
      details: error.response?.data || error.message 
    });
  }
});
// Servir le HTML du frame
app.get('/frame', (req, res) => {
  res.sendFile(__dirname + '/frames/index.html');
});

// Route pour le début du frame (demande level)
app.post('/api/frame/start', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta property="fc:frame" content="vNext" />
      <meta property="fc:frame:image" content="https://i.imgur.com/placeholder-level.png" />
      <meta property="fc:frame:input:text" content="Enter Clankermon Level (1-100)" />
      <meta property="fc:frame:button:1" content="Next" />
      <meta property="fc:frame:button:1:action" content="post" />
      <meta property="fc:frame:post_url" content="${req.protocol}://${req.get('host')}/api/frame/get-type" />
    </head>
    <body>
      <h1>Step 1: Enter Level</h1>
    </body>
    </html>
  `;
  res.send(html);
});

// Route pour demander le type
app.post('/api/frame/get-type', (req, res) => {
  const level = req.body.untrustedData?.inputText || '1';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta property="fc:frame" content="vNext" />
      <meta property="fc:frame:image" content="https://i.imgur.com/placeholder-type.png" />
      <meta property="fc:frame:input:text" content="Enter Clankermon Type (e.g., Fire, Water)" />
      <meta property="fc:frame:button:1" content="Evaluate" />
      <meta property="fc:frame:button:1:action" content="post" />
      <meta property="fc:frame:post_url" content="${req.protocol}://${req.get('host')}/api/frame/evaluate?level=${level}" />
    </head>
    <body>
      <h1>Step 2: Enter Type</h1>
    </body>
    </html>
  `;
  res.send(html);
});

// Route pour évaluer et afficher les résultats
app.post('/api/frame/evaluate', async (req, res) => {
  try {
    const level = req.query.level;
    const cm_type = req.body.untrustedData?.inputText || 'Unknown';

    // Appeler l'API d'évaluation
    const evaluationResponse = await axios.post(
      `http://localhost:${PORT}/api/evaluate`,
      { level, cm_type }
    );

    const data = evaluationResponse.data;
    const finalValuation = data.valuations.find(v => v.category === '_Final');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta property="fc:frame" content="vNext" />
        <meta property="fc:frame:image" content="https://i.imgur.com/placeholder-result.png" />
        <meta property="fc:frame:button:1" content="💝 Donate 0.23 USDC" />
        <meta property="fc:frame:button:1:action" content="tx" />
        <meta property="fc:frame:button:1:target" content="${req.protocol}://${req.get('host')}/api/frame/donate" />
        <meta property="fc:frame:button:2" content="🔄 New Evaluation" />
        <meta property="fc:frame:button:2:action" content="post" />
        <meta property="fc:frame:button:2:post_url" content="${req.protocol}://${req.get('host')}/api/frame/start" />
      </head>
      <body>
        <h1>Evaluation Results</h1>
        <p>Level: ${level} | Type: ${cm_type}</p>
        <p>USD: $${finalValuation?.usd_valuation || '0.00'}</p>
        <p>ETH: Ξ${finalValuation?.eth_valuation || '0.000000'}</p>
      </body>
      </html>
    `;
    res.send(html);

  } catch (error) {
    console.error('Error in frame evaluation:', error);
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta property="fc:frame" content="vNext" />
        <meta property="fc:frame:image" content="https://i.imgur.com/placeholder-error.png" />
        <meta property="fc:frame:button:1" content="Try Again" />
        <meta property="fc:frame:button:1:action" content="post" />
        <meta property="fc:frame:button:1:post_url" content="${req.protocol}://${req.get('host')}/api/frame/start" />
      </head>
      <body>
        <h1>Error</h1>
        <p>Failed to evaluate. Please try again.</p>
      </body>
      </html>
    `;
    res.send(html);
  }
});

// Route pour la transaction de donation
app.post('/api/frame/donate', (req, res) => {
  const donationData = {
    chainId: "eip155:8453", // Base mainnet
    method: "eth_sendTransaction",
    params: {
      abi: [],
      to: process.env.DONATION_ADDRESS,
      value: "230000", // 0.23 USDC (6 decimals)
    }
  };
  
  res.json(donationData);
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📊 Dune API configured: ${process.env.DUNE_API_KEY ? 'Yes ✅' : 'No ❌'}`);
});
