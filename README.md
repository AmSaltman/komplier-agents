# Komplier Agents

Autonomous AI Support Agent for Komplier.co using Gmail, Stripe, and Supabase integrations.

## Features

- 🤖 **Autonomous Email Processing** - Handles customer support emails 24/7
- 📧 **Gmail Integration** - Reads, sends, and manages emails via MCP
- 💳 **Stripe Integration** - Processes refunds and billing inquiries
- 📊 **Supabase Integration** - Accesses user data and project information
- 🧠 **Gemini AI** - Uses Google's Gemini-2.5-flash for intelligent responses
- 📅 **Calendar Access** - Google Calendar integration for scheduling

## Architecture

- **Runtime**: Node.js serverless functions on Vercel
- **Email Processing**: Gmail Push Notifications (no polling)
- **AI Brain**: Google Gemini 2.5 Flash
- **Data Sources**: Supabase, Stripe, JSON knowledge base

## Business Logic

### Auto-Refund Conditions
- Less than 5 compliant assets
- 0 completed projects  
- Less than 30 days since signup
- Default refund amount: $499.00

## Deployment

Deployed to Vercel at: https://komplier-agents.vercel.app

## Endpoints

- `/oauth2callback` - OAuth authentication handler
- `/gmail-webhook` - Gmail push notification receiver
- `/process-emails` - Manual email processing trigger
- `/send-response` - AI response sender
- `/daily-report` - Daily activity summary

## Environment Variables

Required environment variables:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `USER_GOOGLE_EMAIL`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`

## License

Private - Komplier.co