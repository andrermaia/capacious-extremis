import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.resolve('.agents/context.db');
const db = new DatabaseSync(dbPath);

const systems = [
  // -------------------------------------------------------------
  // LOUZA
  // -------------------------------------------------------------
  {
    project_id: 'louza',
    id: 'LOUZA-SYS-001',
    module: 'system_overview',
    feature: 'architecture_topology',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Louza ecosystem consists of 6 repositories: louza (core API), louza-fe (Next.js app), louza-familia (Capacitor/Vite family app), louza-admin (admin portal), louzacrm (CRM service), and louza-nfe (fiscal invoice service).',
    details: 'Multi-repo architecture separating school core backend, family mobile clients, administrative backoffice, CRM, and fiscal note emission.'
  },
  {
    project_id: 'louza',
    id: 'LOUZA-CORE-001',
    module: 'louza',
    feature: 'core_backend',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Core backend service for Louza school management. Implements business domains, student enrollment, academic years, classes, and database persistence.',
    details: 'Folder: louza. Node.js/TypeScript backend with Vitest tests and Docker dev environment.'
  },
  {
    project_id: 'louza',
    id: 'LOUZA-FE-001',
    module: 'louza_fe',
    feature: 'school_portal',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Primary web frontend for schools and educators built with Next.js and TypeScript. Interfaces with the louza core API for school operations.',
    details: 'Folder: louza-fe. Next.js application with Tailwind CSS and TypeScript.'
  },
  {
    project_id: 'louza',
    id: 'LOUZA-FAM-001',
    module: 'louza_familia',
    feature: 'family_mobile_app',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Mobile and web client for parents and families built with Vite and Capacitor for cross-platform iOS and Android deployment.',
    details: 'Folder: louza-familia. Vite + TypeScript + Capacitor for iOS and Android native builds.'
  },
  {
    project_id: 'louza',
    id: 'LOUZA-ADM-001',
    module: 'louza_admin',
    feature: 'superadmin_portal',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Administrative backoffice portal built with Next.js for multi-tenant platform administration, school onboarding, and system configurations.',
    details: 'Folder: louza-admin. Next.js app for system operators.'
  },
  {
    project_id: 'louza',
    id: 'LOUZA-CRM-001',
    module: 'louzacrm',
    feature: 'crm_service',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'CRM and lead pipeline service for student acquisition, admissions tracking, and family engagement workflows.',
    details: 'Folder: louzacrm. Dedicated backend service for school admissions CRM.'
  },
  {
    project_id: 'louza',
    id: 'LOUZA-NFE-001',
    module: 'louza_nfe',
    feature: 'fiscal_invoicing',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Microservice responsible for Brazilian NF-e fiscal note emission, municipal tax integrations, and billing invoice generation.',
    details: 'Folder: louza-nfe. Built with pnpm, Docker, and municipal billing integrations.'
  },

  // -------------------------------------------------------------
  // QLAVE
  // -------------------------------------------------------------
  {
    project_id: 'qlave',
    id: 'QLAVE-SYS-001',
    module: 'system_overview',
    feature: 'e2ee_architecture',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Qlave is a high-security zero-knowledge password and secret manager suite featuring client-side end-to-end encryption (E2EE), cryptographic key rotation, and electronic signature capabilities.',
    details: 'Multi-service architecture composed of core vault backend (qlave), auth provider (qlave-auth), signature engine (qlave-sign), web portal (qlave-fe), and crypto libraries.'
  },
  {
    project_id: 'qlave',
    id: 'QLAVE-CORE-001',
    module: 'qlave_core',
    feature: 'vault_api',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'NestJS backend managing encrypted secret vaults, cryptographic versioning, access control, and master key verification.',
    details: 'Folder: qlave. NestJS, Prisma/PostgreSQL, zero-knowledge secret storage.'
  },
  {
    project_id: 'qlave',
    id: 'QLAVE-AUTH-001',
    module: 'qlave_auth',
    feature: 'identity_provider',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Centralized authentication and identity provider service managing user sessions, multi-factor authentication, and JWT signing for Qlave services.',
    details: 'Folder: qlave-auth. Dedicated authentication and security microservice.'
  },
  {
    project_id: 'qlave',
    id: 'QLAVE-SIGN-001',
    module: 'qlave_sign',
    feature: 'electronic_signature_api',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Electronic signature API handling PDF hashing, PKI certificate signing, biometric audit trails, and multi-signer workflows.',
    details: 'Folder: qlave-sign. Backend microservice adhering to advanced digital signature standards.'
  },
  {
    project_id: 'qlave',
    id: 'QLAVE-SIGNFE-001',
    module: 'qlave_sign_fe',
    feature: 'signature_portal_bff',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Next.js App Router BFF and public web interface where signers review and execute electronic signatures with legal audit logs.',
    details: 'Folder: qlave-sign-fe. Next.js React frontend talking to qlave-sign over internal Docker network.'
  },
  {
    project_id: 'qlave',
    id: 'QLAVE-CRYPTO-001',
    module: 'qlave_crypto',
    feature: 'cryptographic_primitives',
    knowledge_type: 'architecture_decision',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Cryptographic library enforcing Argon2id key derivation, AES-256-GCM symmetric encryption, and Ed25519 digital signature primitives.',
    details: 'Folder: qlave-crypto. Reusable cryptographic package shared across Qlave services.'
  },

  // -------------------------------------------------------------
  // QOINCAMERA
  // -------------------------------------------------------------
  {
    project_id: 'qoincamera',
    id: 'QCAM-SYS-001',
    module: 'system_overview',
    feature: 'surveillance_topology',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Cloud and edge video surveillance platform with local RTSP stream capture, low-latency WebRTC streaming, and Android TV display pairing.',
    details: 'Components: qoincamera-api (cloud management), qoincamera-agent (on-premise RTSP relayer), qoincamera-fe (monitoring portal), qoincamera-tv (Android TV app).'
  },
  {
    project_id: 'qoincamera',
    id: 'QCAM-API-001',
    module: 'qoincamera_api',
    feature: 'streaming_orchestrator',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Backend API coordinating camera configurations, user permissions, stream tokens, recording schedules, and device heartbeats.',
    details: 'Folder: qoincamera-api. REST API managing camera registry and WebRTC session negotiation.'
  },
  {
    project_id: 'qoincamera',
    id: 'QCAM-AGENT-001',
    module: 'qoincamera_agent',
    feature: 'edge_rtsp_relay',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Edge agent deployed inside local school/building networks that discovers IP cameras and securely tunnels RTSP feeds to the cloud.',
    details: 'Folder: qoincamera-agent. Runs locally, tunnels video through MediaMTX without opening router ports.'
  },
  {
    project_id: 'qoincamera',
    id: 'QCAM-TV-001',
    module: 'qoincamera_tv',
    feature: 'android_tv_display',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Android TV APK that pairs with an account via QR code to display low-latency full-screen live video feeds on surveillance wall monitors.',
    details: 'Folder: qoincamera-tv. React-based TV app packaged for Android TV boxes.'
  },

  // -------------------------------------------------------------
  // QOINMSG
  // -------------------------------------------------------------
  {
    project_id: 'qoinmsg',
    id: 'QMSG-SYS-001',
    module: 'system_overview',
    feature: 'messaging_hub',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Multi-tenant transactional and broadcast messaging platform integrating WhatsApp (Uazapi) and Email (Stalwart) with queued delivery.',
    details: 'Folder: qoinmsg (core API) and qoinmsg-fe (Next.js admin dashboard). Handles rate limiting and delivery webhooks.'
  },
  {
    project_id: 'qoinmsg',
    id: 'QMSG-CORE-001',
    module: 'qoinmsg_api',
    feature: 'channel_dispatcher',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Messaging API dispatching WhatsApp notifications through Uazapi instances and emails through Stalwart mail server with fallback queues.',
    details: 'Folder: qoinmsg. Multi-tenant message queue, webhook processor, and channel health monitor.'
  },
  {
    project_id: 'qoinmsg',
    id: 'QMSG-FE-001',
    module: 'qoinmsg_fe',
    feature: 'management_dashboard',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Administrative web panel in Next.js for monitoring delivery queues, managing WhatsApp connection instances, and configuring templates.',
    details: 'Folder: qoinmsg-fe. Next.js application.'
  },

  // -------------------------------------------------------------
  // QOINMODEL
  // -------------------------------------------------------------
  {
    project_id: 'qoinmodel',
    id: 'QMOD-SYS-001',
    module: 'system_overview',
    feature: 'ai_orchestration',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'AI model orchestration, prompt benchmarking, and fine-tuning evaluation platform with comparison analytics.',
    details: 'Folder: qoinmodel (backend API) and qoinmodel-fe (Next.js dashboard for evaluating prompt outputs and latency).'
  },

  // -------------------------------------------------------------
  // QOINPASS
  // -------------------------------------------------------------
  {
    project_id: 'qoinpass',
    id: 'QPASS-SYS-001',
    module: 'system_overview',
    feature: 'access_control_topology',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Mission-critical school access control ecosystem featuring offline-capable edge turnstile agents, ERP sync, and real-time TV displays.',
    details: 'Components: qoinpass-api (NestJS cloud), qoinpass-agent (offline edge controller), qoinpass-display (turnstile TV display), qoinpass-fe (portal), qoinpass-sponte-connector (ERP worker).'
  },
  {
    project_id: 'qoinpass',
    id: 'QPASS-AGENT-001',
    module: 'qoinpass_agent',
    feature: 'offline_turnstile_engine',
    knowledge_type: 'architecture_decision',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'On-premise hardware agent that evaluates gate passage in under 15ms completely offline using a local SQLite replica and hardware relays.',
    details: 'Folder: qoinpass-agent. Highest reliability requirement: school turnstiles must operate even during complete internet outages.'
  },
  {
    project_id: 'qoinpass',
    id: 'QPASS-SPONTE-001',
    module: 'qoinpass_sponte',
    feature: 'erp_synchronizer',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Background worker syncing students and guardians from Sponte ERP into cryptographically signed canonical passage events for QoinPass.',
    details: 'Folder: qoinpass-sponte-connector. Keeps the QoinPass core completely decoupled from school ERP internals.'
  },
  {
    project_id: 'qoinpass',
    id: 'QPASS-DISP-001',
    module: 'qoinpass_display',
    feature: 'turnstile_screen',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Turnstile TV box app displaying real-time student photo, class, and authorized guardian pickup status immediately upon passage.',
    details: 'Folder: qoinpass-display. WebSocket/local network updates with sub-second latency.'
  },

  // -------------------------------------------------------------
  // QOINPAY
  // -------------------------------------------------------------
  {
    project_id: 'qoinpay',
    id: 'QPAY-SYS-001',
    module: 'system_overview',
    feature: 'fintech_payment_hub',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Payment processing gateway supporting Brazilian Pix (instant QR code and copy-paste), credit cards, and automated webhook settlement.',
    details: 'Folder: qoinpay (NestJS backend API) and qoinpay-frontend (Vite + React checkout interface).'
  },
  {
    project_id: 'qoinpay',
    id: 'QPAY-CORE-001',
    module: 'qoinpay_api',
    feature: 'payment_engine',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'NestJS financial backend managing charge generation, bank API integrations, webhook signature verification, and ledger reconciliation.',
    details: 'Folder: qoinpay. Idempotency keys, bank webhook callbacks, and transaction audit trails.'
  },

  // -------------------------------------------------------------
  // QOINSTORE
  // -------------------------------------------------------------
  {
    project_id: 'qoinstore',
    id: 'QSTR-SYS-001',
    module: 'system_overview',
    feature: 'ecommerce_suite',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'E-commerce platform for school uniforms, materials, and merchandise with inventory management, cart workflows, and payment checkout.',
    details: 'Folder: qoinstore (NestJS catalog and order API) and qoinstore-fe (Next.js storefront and order manager).'
  },

  // -------------------------------------------------------------
  // QOINSITE
  // -------------------------------------------------------------
  {
    project_id: 'qoinsite',
    id: 'QSITE-SYS-001',
    module: 'system_overview',
    feature: 'visual_page_builder',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Multi-file visual WYSIWYG landing page editor and static site generator in the style of Webflow Lite, hosted at qoin.site.',
    details: 'Folder: qoinsite. NestJS 11 backend with React visual editing canvas, block rendering, and static HTML export.'
  },

  // -------------------------------------------------------------
  // QOINPOKER
  // -------------------------------------------------------------
  {
    project_id: 'qpoker',
    id: 'QPOKER-SYS-001',
    module: 'system_overview',
    feature: 'tournament_suite',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Poker tournament management ecosystem with real-time blinds clocks, player registrations, multi-table balancing, and multi-platform TV displays.',
    details: 'Components: qoinpoker (engine), qoinpoker-fe (director panel), qoinpoker-tv (Samsung/LG smart TVs), qoinpoker-roku (Roku OS app).'
  },
  {
    project_id: 'qpoker',
    id: 'QPOKER-TV-001',
    module: 'qoinpoker_tv',
    feature: 'blinds_clock_tv',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Smart TV application for Samsung Tizen, LG webOS, and Roku devices rendering real-time blind timers, chip averages, and payouts.',
    details: 'Folders: qoinpoker-tv (React + Vite webOS/Tizen) and qoinpoker-roku (BrightScript + SceneGraph).'
  },

  // -------------------------------------------------------------
  // QOINREVIEWS
  // -------------------------------------------------------------
  {
    project_id: 'qoinreviews',
    id: 'QREV-SYS-001',
    module: 'system_overview',
    feature: 'reputation_management',
    knowledge_type: 'system_model',
    phase: 'implemented',
    tasks_progress: null,
    summary: 'Customer satisfaction feedback, Net Promoter Score (NPS) surveys, and online reputation management service with automated review requests.',
    details: 'Folder: qoinreviews (backend review processor) and qoinreviews-fe (React + Vite customer survey interface).'
  }
];

// Validate all summaries <= 250 characters
for (const s of systems) {
  if (s.summary.length > 250) {
    throw new Error(`Summary too long (${s.summary.length} chars) in ${s.id}: "${s.summary}"`);
  }
}

const stmt = db.prepare(`
  INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id,
    module = excluded.module,
    feature = excluded.feature,
    knowledge_type = excluded.knowledge_type,
    phase = excluded.phase,
    tasks_progress = excluded.tasks_progress,
    summary = excluded.summary,
    details = excluded.details,
    updated_at = excluded.updated_at
`);

let inserted = 0;
for (const s of systems) {
  stmt.run(
    s.id,
    s.project_id,
    s.module,
    s.feature,
    s.knowledge_type,
    s.phase,
    s.tasks_progress,
    s.summary,
    s.details,
    new Date().toISOString()
  );
  inserted++;
}

console.log(JSON.stringify({
  status: 'ok',
  inserted_count: inserted,
  projects: [...new Set(systems.map(s => s.project_id))]
}, null, 2));
