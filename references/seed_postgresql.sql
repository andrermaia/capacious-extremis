-- Seed data for PostgreSQL (Takius)
-- Contains all 32 initial system knowledge records

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('LOUZA-ADM-001', 'louza', 'louza_admin', 'superadmin_portal', 'system_model', 'implemented', NULL, 'Administrative backoffice portal built with Next.js for multi-tenant platform administration, school onboarding, and system configurations.', 'Folder: louza-admin. Next.js app for system operators.', '2026-09-15T20:38:03.010Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('LOUZA-CORE-001', 'louza', 'louza', 'core_backend', 'system_model', 'implemented', NULL, 'Core backend service for Louza school management. Implements business domains, student enrollment, academic years, classes, and database persistence.', 'Folder: louza. Node.js/TypeScript backend with Vitest tests and Docker dev environment.', '2026-09-15T20:38:02.951Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('LOUZA-CRM-001', 'louza', 'louzacrm', 'crm_service', 'system_model', 'implemented', NULL, 'CRM and lead pipeline service for student acquisition, admissions tracking, and family engagement workflows.', 'Folder: louzacrm. Dedicated backend service for school admissions CRM.', '2026-09-15T20:38:03.029Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('LOUZA-FAM-001', 'louza', 'louza_familia', 'family_mobile_app', 'system_model', 'implemented', NULL, 'Mobile and web client for parents and families built with Vite and Capacitor for cross-platform iOS and Android deployment.', 'Folder: louza-familia. Vite + TypeScript + Capacitor for iOS and Android native builds.', '2026-09-15T20:38:02.989Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('LOUZA-FE-001', 'louza', 'louza_fe', 'school_portal', 'system_model', 'implemented', NULL, 'Primary web frontend for schools and educators built with Next.js and TypeScript. Interfaces with the louza core API for school operations.', 'Folder: louza-fe. Next.js application with Tailwind CSS and TypeScript.', '2026-09-15T20:38:02.971Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('LOUZA-NFE-001', 'louza', 'louza_nfe', 'fiscal_invoicing', 'system_model', 'implemented', NULL, 'Microservice responsible for Brazilian NF-e fiscal note emission, municipal tax integrations, and billing invoice generation.', 'Folder: louza-nfe. Built with pnpm, Docker, and municipal billing integrations.', '2026-09-15T20:38:03.048Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('LOUZA-SYS-001', 'louza', 'system_overview', 'architecture_topology', 'system_model', 'implemented', NULL, 'Louza ecosystem consists of 6 repositories: louza (core API), louza-fe (Next.js app), louza-familia (Capacitor/Vite family app), louza-admin (admin portal), louzacrm (CRM service), and louza-nfe (fiscal invoice service).', 'Multi-repo architecture separating school core backend, family mobile clients, administrative backoffice, CRM, and fiscal note emission.', '2026-09-15T20:38:02.929Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QLAVE-AUTH-001', 'qlave', 'qlave_auth', 'identity_provider', 'system_model', 'implemented', NULL, 'Centralized authentication and identity provider service managing user sessions, multi-factor authentication, and JWT signing for Qlave services.', 'Folder: qlave-auth. Dedicated authentication and security microservice.', '2026-09-15T20:38:03.096Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QLAVE-CORE-001', 'qlave', 'qlave_core', 'vault_api', 'system_model', 'implemented', NULL, 'NestJS backend managing encrypted secret vaults, cryptographic versioning, access control, and master key verification.', 'Folder: qlave. NestJS, Prisma/PostgreSQL, zero-knowledge secret storage.', '2026-09-15T20:38:03.080Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QLAVE-CRYPTO-001', 'qlave', 'qlave_crypto', 'cryptographic_primitives', 'architecture_decision', 'implemented', NULL, 'Cryptographic library enforcing Argon2id key derivation, AES-256-GCM symmetric encryption, and Ed25519 digital signature primitives.', 'Folder: qlave-crypto. Reusable cryptographic package shared across Qlave services.', '2026-09-15T20:38:03.155Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QLAVE-SIGN-001', 'qlave', 'qlave_sign', 'electronic_signature_api', 'system_model', 'implemented', NULL, 'Electronic signature API handling PDF hashing, PKI certificate signing, biometric audit trails, and multi-signer workflows.', 'Folder: qlave-sign. Backend microservice adhering to advanced digital signature standards.', '2026-09-15T20:38:03.116Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QLAVE-SIGNFE-001', 'qlave', 'qlave_sign_fe', 'signature_portal_bff', 'system_model', 'implemented', NULL, 'Next.js App Router BFF and public web interface where signers review and execute electronic signatures with legal audit logs.', 'Folder: qlave-sign-fe. Next.js React frontend talking to qlave-sign over internal Docker network.', '2026-09-15T20:38:03.135Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QLAVE-SYS-001', 'qlave', 'system_overview', 'e2ee_architecture', 'system_model', 'implemented', NULL, 'Qlave is a high-security zero-knowledge password and secret manager suite featuring client-side end-to-end encryption (E2EE), cryptographic key rotation, and electronic signature capabilities.', 'Multi-service architecture composed of core vault backend (qlave), auth provider (qlave-auth), signature engine (qlave-sign), web portal (qlave-fe), and crypto libraries.', '2026-09-15T20:38:03.064Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QCAM-AGENT-001', 'qoincamera', 'qoincamera_agent', 'edge_rtsp_relay', 'system_model', 'implemented', NULL, 'Edge agent deployed inside local school/building networks that discovers IP cameras and securely tunnels RTSP feeds to the cloud.', 'Folder: qoincamera-agent. Runs locally, tunnels video through MediaMTX without opening router ports.', '2026-09-15T20:38:03.217Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QCAM-API-001', 'qoincamera', 'qoincamera_api', 'streaming_orchestrator', 'system_model', 'implemented', NULL, 'Backend API coordinating camera configurations, user permissions, stream tokens, recording schedules, and device heartbeats.', 'Folder: qoincamera-api. REST API managing camera registry and WebRTC session negotiation.', '2026-09-15T20:38:03.195Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QCAM-SYS-001', 'qoincamera', 'system_overview', 'surveillance_topology', 'system_model', 'implemented', NULL, 'Cloud and edge video surveillance platform with local RTSP stream capture, low-latency WebRTC streaming, and Android TV display pairing.', 'Components: qoincamera-api (cloud management), qoincamera-agent (on-premise RTSP relayer), qoincamera-fe (monitoring portal), qoincamera-tv (Android TV app).', '2026-09-15T20:38:03.177Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QCAM-TV-001', 'qoincamera', 'qoincamera_tv', 'android_tv_display', 'system_model', 'implemented', NULL, 'Android TV APK that pairs with an account via QR code to display low-latency full-screen live video feeds on surveillance wall monitors.', 'Folder: qoincamera-tv. React-based TV app packaged for Android TV boxes.', '2026-09-15T20:38:03.238Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QMOD-SYS-001', 'qoinmodel', 'system_overview', 'ai_orchestration', 'system_model', 'implemented', NULL, 'AI model orchestration, prompt benchmarking, and fine-tuning evaluation platform with comparison analytics.', 'Folder: qoinmodel (backend API) and qoinmodel-fe (Next.js dashboard for evaluating prompt outputs and latency).', '2026-09-15T20:38:03.331Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QMSG-CORE-001', 'qoinmsg', 'qoinmsg_api', 'channel_dispatcher', 'system_model', 'implemented', NULL, 'Messaging API dispatching WhatsApp notifications through Uazapi instances and emails through Stalwart mail server with fallback queues.', 'Folder: qoinmsg. Multi-tenant message queue, webhook processor, and channel health monitor.', '2026-09-15T20:38:03.278Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QMSG-FE-001', 'qoinmsg', 'qoinmsg_fe', 'management_dashboard', 'system_model', 'implemented', NULL, 'Administrative web panel in Next.js for monitoring delivery queues, managing WhatsApp connection instances, and configuring templates.', 'Folder: qoinmsg-fe. Next.js application.', '2026-09-15T20:38:03.308Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QMSG-SYS-001', 'qoinmsg', 'system_overview', 'messaging_hub', 'system_model', 'implemented', NULL, 'Multi-tenant transactional and broadcast messaging platform integrating WhatsApp (Uazapi) and Email (Stalwart) with queued delivery.', 'Folder: qoinmsg (core API) and qoinmsg-fe (Next.js admin dashboard). Handles rate limiting and delivery webhooks.', '2026-09-15T20:38:03.258Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPASS-AGENT-001', 'qoinpass', 'qoinpass_agent', 'offline_turnstile_engine', 'architecture_decision', 'implemented', NULL, 'On-premise hardware agent that evaluates gate passage in under 15ms completely offline using a local SQLite replica and hardware relays.', 'Folder: qoinpass-agent. Highest reliability requirement: school turnstiles must operate even during complete internet outages.', '2026-09-15T20:38:03.374Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPASS-DISP-001', 'qoinpass', 'qoinpass_display', 'turnstile_screen', 'system_model', 'implemented', NULL, 'Turnstile TV box app displaying real-time student photo, class, and authorized guardian pickup status immediately upon passage.', 'Folder: qoinpass-display. WebSocket/local network updates with sub-second latency.', '2026-09-15T20:38:03.415Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPASS-SPONTE-001', 'qoinpass', 'qoinpass_sponte', 'erp_synchronizer', 'system_model', 'implemented', NULL, 'Background worker syncing students and guardians from Sponte ERP into cryptographically signed canonical passage events for QoinPass.', 'Folder: qoinpass-sponte-connector. Keeps the QoinPass core completely decoupled from school ERP internals.', '2026-09-15T20:38:03.394Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPASS-SYS-001', 'qoinpass', 'system_overview', 'access_control_topology', 'system_model', 'implemented', NULL, 'Mission-critical school access control ecosystem featuring offline-capable edge turnstile agents, ERP sync, and real-time TV displays.', 'Components: qoinpass-api (NestJS cloud), qoinpass-agent (offline edge controller), qoinpass-display (turnstile TV display), qoinpass-fe (portal), qoinpass-sponte-connector (ERP worker).', '2026-09-15T20:38:03.354Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPAY-CORE-001', 'qoinpay', 'qoinpay_api', 'payment_engine', 'system_model', 'implemented', NULL, 'NestJS financial backend managing charge generation, bank API integrations, webhook signature verification, and ledger reconciliation.', 'Folder: qoinpay. Idempotency keys, bank webhook callbacks, and transaction audit trails.', '2026-09-15T20:38:03.455Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPAY-SYS-001', 'qoinpay', 'system_overview', 'fintech_payment_hub', 'system_model', 'implemented', NULL, 'Payment processing gateway supporting Brazilian Pix (instant QR code and copy-paste), credit cards, and automated webhook settlement.', 'Folder: qoinpay (NestJS backend API) and qoinpay-frontend (Vite + React checkout interface).', '2026-09-15T20:38:03.435Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QREV-SYS-001', 'qoinreviews', 'system_overview', 'reputation_management', 'system_model', 'implemented', NULL, 'Customer satisfaction feedback, Net Promoter Score (NPS) surveys, and online reputation management service with automated review requests.', 'Folder: qoinreviews (backend review processor) and qoinreviews-fe (React + Vite customer survey interface).', '2026-09-15T20:38:03.563Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QSITE-SYS-001', 'qoinsite', 'system_overview', 'visual_page_builder', 'system_model', 'implemented', NULL, 'Multi-file visual WYSIWYG landing page editor and static site generator in the style of Webflow Lite, hosted at qoin.site.', 'Folder: qoinsite. NestJS 11 backend with React visual editing canvas, block rendering, and static HTML export.', '2026-09-15T20:38:03.496Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QSTR-SYS-001', 'qoinstore', 'system_overview', 'ecommerce_suite', 'system_model', 'implemented', NULL, 'E-commerce platform for school uniforms, materials, and merchandise with inventory management, cart workflows, and payment checkout.', 'Folder: qoinstore (NestJS catalog and order API) and qoinstore-fe (Next.js storefront and order manager).', '2026-09-15T20:38:03.476Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPOKER-SYS-001', 'qpoker', 'system_overview', 'tournament_suite', 'system_model', 'implemented', NULL, 'Poker tournament management ecosystem with real-time blinds clocks, player registrations, multi-table balancing, and multi-platform TV displays.', 'Components: qoinpoker (engine), qoinpoker-fe (director panel), qoinpoker-tv (Samsung/LG smart TVs), qoinpoker-roku (Roku OS app).', '2026-09-15T20:38:03.515Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
VALUES ('QPOKER-TV-001', 'qpoker', 'qoinpoker_tv', 'blinds_clock_tv', 'system_model', 'implemented', NULL, 'Smart TV application for Samsung Tizen, LG webOS, and Roku devices rendering real-time blind timers, chip averages, and payouts.', 'Folders: qoinpoker-tv (React + Vite webOS/Tizen) and qoinpoker-roku (BrightScript + SceneGraph).', '2026-09-15T20:38:03.539Z')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  knowledge_type = EXCLUDED.knowledge_type,
  phase = EXCLUDED.phase,
  tasks_progress = EXCLUDED.tasks_progress,
  summary = EXCLUDED.summary,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at;

