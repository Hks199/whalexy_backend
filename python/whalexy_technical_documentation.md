# Whalexy - Technical & Routing Reference Documentation

Welcome to the **Whalexy Technical Documentation**. This document consolidates features, navigation routes, integration configurations, APIs, and webhook structures for Whalexy, the AI-Powered WhatsApp CRM & Marketing Platform. It serves as a knowledge base for the **Whalexy AI** and a guide for Whalexy vendors.

---

## Table of Contents
1. [Overview of Whalexy](#-overview-of-Whalexy)
2. [Vendor Console Features & Route Reference](#-vendor-console-features--route-reference)
3. [AI Chat & Navigation Assistant Mapping](#-ai-chat--navigation-assistant-mapping)
4. [Common Vendor Tasks - Step-by-Step UI Guides](#common-vendor-tasks--step-by-step-ui-guides)
5. [External Developer API Reference](#external-developer-api-reference)
6. [Webhook & Integration Events](#webhook--integration-events)
7. [Key Core Codebase References](#key-core-codebase-references)

---

## Overview of Whalexy

**Whalexy** is an AI-powered WhatsApp CRM and marketing platform built for business owners, sales teams, and conversational commerce. The platform acts as a unified space to consolidate customer chats, marketing broadcasts, catalog sales, and automated workflows.

### Core Ecosystem Architecture
- **Framework**: Laravel PHP
- **Messaging Integration**: Facebook Graph API (for WhatsApp Cloud API, Messenger API, and Instagram Graph API).
- **Commerce Integration**: Built-in WhatsApp Catalog Sync & Checkout, along with two-way Shopify and WooCommerce connectors.
- **Automation Engine**: Keyword-based auto-replies, an interactive visual Bot Flow Builder, Google Sheets sync, and AI chatbot assistance.

---

## Vendor Console Features & Route Reference

All vendor actions happen inside the **Vendor Console**, mapped under the prefix `/vendor-console`. Access is authenticated via the `VendorAccessCheckpost` middleware.

### 1. Dashboard & Analytics
- **Purpose**: Get real-time stats on messages sent, delivered, read, and conversion metrics.
- **URL Path**: `/vendor-console`
- **Route Name**: `vendor.console`
- **Controller Method**: `DashboardController@vendorDashboardView`

### 2. Smart Inbox (Live Chat & Team Inbox)
- **Purpose**: A collaborative inbox where agents converse with customers across WhatsApp, Messenger, and Instagram.
- **Key Capabilities**: 
  - Send texts, media uploads, location messages, and WhatsApp template messages.
  - Assign agents/users to a conversation.
  - Tag contacts with custom labels.
  - Save internal contact notes.
- **URL Path**: `/vendor-console/whatsapp/contact/chat/{contactUid?}`
- **Route Name**: `vendor.chat_message.contact.view`
- **Controller Method**: `WhatsAppServiceController@chatView`

### 3. Broadcast Campaigns
- **Purpose**: Schedule templates and broadcast messages to large contact lists or groups.
- **Key Capabilities**:
  - Launch campaigns, view real-time status (queued, failed, executed).
  - Duplicate, archive/unarchive campaigns.
  - Requeue failed campaign messages.
  - Export CSV reports (executed list, queued log, failed logs).
- **URL Path**: `/vendor-console/whatsapp/campaign`
- **Route Name**: `vendor.campaign.read.list_view`
- **Controller Method**: `CampaignController@showCampaignView`

### 4. Interactive WhatsApp Flows
- **Purpose**: Meta WhatsApp Flows allow sending structured forms (e.g. registrations, feedback surveys, bookings) inside WhatsApp messages.
- **Key Capabilities**: Create, edit, delete, preview (and demo-preview), and launch flow templates.
- **URL Path**: `/vendor-console/whatsapp/flows`
- **Route Name**: `whatsapp-flows.index`
- **Controller Method**: `WhatsAppFlowController@index`

### 5. WhatsApp Commerce & Catalog Settings
- **Purpose**: Display digital store catalogs directly inside customer chats.
- **Key Capabilities**: Fetch configurations from Meta, toggle auto-sync, view imported catalog products, and test Commerce API connections.
- **URL Path**: `/vendor-console/whatsapp/commerce`
- **Route Name**: `vendor.whatsapp.commerce.settings`
- **Controller Method**: `WhatsAppCommerceController@showCommerceSettings`

### 6. WhatsApp Orders & Invoices
- **Purpose**: View and manage transactions submitted through WhatsApp Catalogs.
- **Key Capabilities**: Track order statuses, fetch orders, view order details, print/download PDF receipts, export order reports, and verify payment gateways.
- **URL Path**: `/vendor-console/whatsapp-orders`
- **Route Name**: `vendor.whatsapp.orders.list`
- **Controller Method**: `WhatsAppOrderController@showOrdersList`

### 7. Facebook & Instagram Messaging Integration
- **Purpose**: Engage with users on Facebook Pages and Instagram Direct Messaging.
- **Key Capabilities**:
  - Test Meta API connections.
  - Pull Facebook/Instagram conversation list and live chat threads.
  - View Instagram media posts and fetch/reply to comments.
  - Retrieve page information and monitor communication statistics.
- **Facebook Chat Path**: `/vendor-console/facebook/chat`
- **Instagram Chat Path**: `/vendor-console/instagram/conversations`
- **Instagram Media Path**: `/vendor-console/instagram/media`

### 8. Bot Replies & Visual Bot Flows
- **Purpose**: Create automated customer service bots.
- **Key Capabilities**:
  - Define exact keyword-match triggers.
  - Visual builder to chart complex chat decision trees (Bot Flows).
  - Export and Import custom bot flows (JSON).
- **URL Path (Keywords)**: `/vendor-console/bot-replies`
- **Route Name**: `vendor.bot_reply.read.list_view`
- **URL Path (Visual Flows)**: `/vendor-console/bot-replies/bot-flows`
- **Route Name**: `vendor.bot_reply.bot_flow.read.list_view`
- **Controller**: `BotReplyController` & `BotFlowController`

### 9. Contacts & Group Segments
- **Purpose**: Contact CRM and segmentation engine.
- **Key Capabilities**:
  - Create custom fields for contact profiles.
  - Group contacts (segments) for targeted broadcasts.
  - Bulk actions: delete, assign groups, toggle AI bots.
  - Import/Export contact records.
- **URL Path**: `/vendor-console/contacts/list`
- **Route Name**: `vendor.contact.read.list_view`
- **Controller Method**: `ContactController@showContactView`

### 10. Google Sheet Script Integration
- **Purpose**: Seamless integration with Google Sheets.
- **Key Capabilities**: Generates custom Google Apps Scripts to automatically push new sheet rows into Whalexy CRM contacts.
- **URL Path**: `/vendor-console/google-sheet-script`
- **Route Name**: `google-sheet-script.index`
- **Controller Method**: `GoogleSheetScriptController@index`

### 11. Integrations (Shopify & WooCommerce)
- **Purpose**: Connect external checkouts to trigger automated post-purchase notifications (Order Placed, Out for Delivery, Abandoned Checkout Recovery).
- **Shopify URL Path**: `/vendor-console/integration/shopify/dashboard`
- **Shopify Route Name**: `vendor.integration.shopify.dashboard`
- **WooCommerce URL Path**: `/vendor-console/integration/woocommerce/dashboard`
- **WooCommerce Route Name**: `vendor.integration.woocommerce.dashboard`

### 12. Meta Embedded Signup (WhatsApp Onboarding)
- **Purpose**: Easy self-service onboarding for new vendors to bind their Meta WhatsApp Business Accounts.
- **Key Capabilities**: Embedded signup process, sync Meta phone numbers, verify Two-Factor Authentication, and request verified display name edits.
- **Embedded Signup Endpoint**: `/vendor-console/embedded-signup-process` (`vendor.whatsapp_setup.embedded_signup.write`)
- **TFA Verification Endpoint**: `/vendor-console/two-factor-auth/verify` (`vendor.whatsapp.two_factor_auth.verify`)

### 13. Configuration & Settings
- **Purpose**: Establish basic business details, custom notifications, email/mail configuration, and profile settings.
- **URL Path**: `/vendor-console/settings`
- **Route Name**: `vendor.settings.read`
- **Controller Method**: `VendorSettingsController@index`

---

## AI Chat & Navigation Assistant Mapping

Whalexy AI can guide vendors to the correct path in the console using the following routing database. When a vendor asks the AI: *"Where do I do X?"* or *"How to X?"*, the AI should direct them to the appropriate URL or route.

| User Task / Intent | Navigate to URL | Laravel Route Name |
| :--- | :--- | :--- |
| Check store status or general analytics | `/vendor-console` | `vendor.console` |
| Message a contact or check inbox | `/vendor-console/whatsapp/contact/chat` | `vendor.chat_message.contact.view` |
| Launch a template broadcast campaign | `/vendor-console/whatsapp/campaign` | `vendor.campaign.read.list_view` |
| Create a new broadcast campaign | `/vendor-console/whatsapp/campaign/new` | `vendor.campaign.new.view` |
| Manage template messages sync | `/vendor-console/whatsapp/templates` | `vendor.whatsapp_service.templates.read.list_view` |
| Build visual interactive WhatsApp Flows | `/vendor-console/whatsapp/flows` | `whatsapp-flows.index` |
| View product catalog or sync settings | `/vendor-console/whatsapp/commerce` | `vendor.whatsapp.commerce.settings` |
| Track customer orders from WhatsApp | `/vendor-console/whatsapp-orders` | `vendor.whatsapp.orders.list` |
| Set up automatic bot replies | `/vendor-console/bot-replies` | `vendor.bot_reply.read.list_view` |
| Setup visual bot flows builder | `/vendor-console/bot-replies/bot-flows` | `vendor.bot_reply.bot_flow.read.list_view` |
| Import, view, or segment contacts | `/vendor-console/contacts/list` | `vendor.contact.read.list_view` |
| Add new database fields to contacts | `/vendor-console/contacts/custom-fields` | `vendor.contact.custom_field.read.list_view` |
| Group contacts into mailing groups | `/vendor-console/contacts/groups` | `vendor.contact.group.read.list_view` |
| Connect my Shopify store | `/vendor-console/integration/shopify/dashboard` | `vendor.integration.shopify.dashboard` |
| Connect my WooCommerce store | `/vendor-console/integration/woocommerce/dashboard` | `vendor.integration.woocommerce.dashboard` |
| Setup Apps Script for Google Sheets | `/vendor-console/google-sheet-script` | `google-sheet-script.index` |
| Manage WhatsApp configuration & profile | `/vendor-console/settings` | `vendor.settings.read` |
| View subscription plan / download invoice | `/vendor-console/subscription` | `subscription.read.show` |
| Onboard via Meta Embedded Signup | `/vendor-console/settings` | `vendor.settings.read` |
| Chat with customer on Facebook Messenger | `/vendor-console/facebook/chat` | `vendor.facebook.chat` |
| Manage Instagram DMs and comment replies | `/vendor-console/instagram/conversations` | `vendor.instagram.conversations` |

---

## Common Vendor Tasks - Step-by-Step UI Guides

This section provides step-by-step UI actions for typical vendor operations, enabling the Whalexy AI chatbot to answer specific "How to" queries with exact directions.

### 1. How do I assign a chat to my agent / team member?
- **Exact Route/URL**: `/vendor-console/whatsapp/contact/chat` (`vendor.chat_message.contact.view`)
- **UI Steps**:
  1. Open the **Smart Inbox** page.
  2. Select the specific contact conversation from the left sidebar chat list.
  3. In the chat window's top-right header, click the **CRM Toggle** button to slide open the right-side detail drawer.
  4. In this right drawer, click on the **CRM Details** tab (located next to the "AI Intelligence" tab).
  5. Scroll down to the **Assign Team Member** section.
  6. Choose your agent's name from the dropdown selection list.
  7. Click the **Save Assignment** button.

### 2. How do I import my contacts list?
- **Exact Route/URL**: `/vendor-console/contacts/list` (`vendor.contact.read.list_view`)
- **UI Steps**:
  1. Navigate to the **Contacts** module.
  2. Click the **Import** button in the action header.
  3. Choose and upload your CSV or Excel file containing contact data.
  4. Map your CSV column headers to the Whalexy contact database fields (e.g. Phone, Name, Email).
  5. Click the **Process Import** button to upload and save contacts.

### 3. How do I sync template messages from Meta?
- **Exact Route/URL**: `/vendor-console/whatsapp/templates` (`vendor.whatsapp_service.templates.read.list_view`)
- **UI Steps**:
  1. Navigate to the **WhatsApp Templates** page.
  2. Click the **Sync Templates** button at the top.
  3. Whalexy will connect to Meta APIs, sync all approved template message definitions, and update your local platform library.

### 4. How do I resend or requeue failed campaign messages?
- **Exact Route/URL**: `/vendor-console/whatsapp/campaign` (`vendor.campaign.read.list_view`)
- **UI Steps**:
  1. Navigate to the **Campaigns** dashboard.
  2. Find your sent campaign in the list and click to open its status: `/vendor-console/whatsapp/campaign/status/{campaignUid}/view`.
  3. On the campaign metrics page, click the **Requeue Failed Messages** button.
  4. This pushes failed items back into the messaging queue to automatically retry transmission.

### 5. How do I connect my Shopify store?
- **Exact Route/URL**: `/vendor-console/integration/shopify/dashboard` (`vendor.integration.shopify.dashboard`)
- **UI Steps**:
  1. Go to **Integrations** -> **Shopify**.
  2. Switch to the **Settings** tab.
  3. Enter your Shopify store subdomain, API Admin Access Token, and Webhook Secret.
  4. Click the **Connect** button.
  5. Once active, go to **Notification Settings** on the same page to choose which transactional alerts (e.g. Order Confirmation, Cart Recovery) to send to your buyers.

---

## External Developer API Reference

For vendors who want to programmatically interface with their Whalexy workspace (e.g. from a custom CRM or website), Whalexy provides an external API with authentication middleware `api.vendor.authenticate`.

- **Base Endpoint**: `/api`

### 1. Send Chat Message
- **Endpoint**: `POST /api/{vendorUid}/contact/send-message`
- **Route Name**: `api.vendor.chat_message.send.process`
- **Parameters**: `phoneNumber`, `messageText`

### 2. Send Media Chat Message
- **Endpoint**: `POST /api/{vendorUid}/contact/send-media-message`
- **Route Name**: `api.vendor.chat_message_media.send.process`
- **Parameters**: `phoneNumber`, `mediaUrl`, `mediaType` (image, video, document, audio)

### 3. Send Template Chat Message
- **Endpoint**: `POST /api/{vendorUid}/contact/send-template-message`
- **Route Name**: `api.vendor.chat_template_message.send.process`
- **Parameters**: `phoneNumber`, `templateName`, `languageCode`, `components` (header/body variables)

### 4. Create New Contact
- **Endpoint**: `POST /api/{vendorUid}/contact/create`
- **Route Name**: `api.vendor.contact.create.process`
- **Parameters**: `phoneNumber`, `firstName`, `lastName`, `email`, `customFields`

### 5. Update Contact
- **Endpoint**: `POST /api/{vendorUid}/contact/update/{phoneNumber}`
- **Route Name**: `api.vendor.contact.update.process`
- **Parameters**: `firstName`, `lastName`, `email`, `customFields`

---

## Webhook & Integration Events

Whalexy exposes specialized endpoints to listen to actions from Meta platforms, payment gateways, and e-commerce checkouts.

### Meta Webhooks
- **WhatsApp Webhook**: `/whatsapp-webhook/{vendorUid}` (`vendor.whatsapp_webhook`)
  - Receives live incoming messages, message delivery receipts, status updates, and interactive flow submissions.
- **Facebook Messenger Webhook**: `/facebook/webhook/{vendorUid}` (`facebook.webhook`)
  - Listens to incoming pages messenger conversations.
- **Instagram Webhook**: `/instagram/webhook/{vendorUid}` (`instagram.webhook`)
  - Listens to Instagram direct messages and comments.

### E-commerce Webhooks
- **Shopify Webhook Handler**: `/shopify-webhook/vendor/{vendorId}` (`shopify.webhook.vendor`)
  - Configurable in Shopify Admin to listen to events like `orders/create`, `checkouts/create` (cart abandonments), and updates.
- **WooCommerce Webhook Handler**: `/woocommerce-webhook/vendor/{vendorId}` (`webhook.woocommerce.vendor`)
  - Configurable in WooCommerce REST settings.

### Payment Webhooks
- **RazorPay Gateway**: `/whatsapp/payment/webhook/razorpay` (`whatsapp.payment.webhook.razorpay`)
  - Dispatches order payments success webhooks.
- **PhonePe Gateway**: `/whatsapp/payment/webhook/phonepe` (`whatsapp.payment.webhook.phonepe`)

---

## Key Core Codebase References

Developers needing to edit routing or core logic can refer to these files:
- **Routing Rules**:
  - Web routes: [routes/web.php](file:///e:/MobiusBloom.in/routes/web.php)
  - Developer API: [routes/api.php](file:///e:/MobiusBloom.in/routes/api.php)
  - Facebook integration: [routes/facebook-routes.php](file:///e:/MobiusBloom.in/routes/facebook-routes.php)
  - Facebook live chats: [routes/facebook-chat-routes.php](file:///e:/MobiusBloom.in/routes/facebook-chat-routes.php)
  - Instagram integration: [routes/instagram-routes.php](file:///e:/MobiusBloom.in/routes/instagram-routes.php)
- **Controller Implementations**:
  - WhatsApp Business logic: `App\Yantrana\Components\WhatsAppService\Controllers\WhatsAppServiceController`
  - Visual builder flows: `App\Yantrana\Components\BotReply\Controllers\BotFlowController`
  - Broadcast campaign engine: `App\Yantrana\Components\Campaign\Controllers\CampaignController`
  - Contact CRM structure: `App\Yantrana\Components\Contact\Controllers\ContactController`
  - Shopify gateway: `App\Yantrana\Components\Integration\Shopify\Controllers\ShopifyIntegrationController`
  - WooCommerce gateway: `App\Yantrana\Components\Integration\WooCommerce\Controllers\WooCommerceIntegrationController`
