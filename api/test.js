export default function handler(req, res) {
  return new Response('TEST ENDPOINT WORKING!', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  });
}
