// Simple test endpoint without any dependencies
module.exports = function handler(req, res) {
  try {
    console.log('Simple test endpoint called');
    res.status(200).json({ 
      message: 'Simple test working!', 
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url
    });
  } catch (error) {
    console.error('Simple test error:', error);
    res.status(500).json({ error: error.message });
  }
}
