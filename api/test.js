module.exports = function handler(req, res) {
  res.status(200).setHeader('Content-Type', 'text/plain');
  return res.send('TEST ENDPOINT WORKING!');
}
