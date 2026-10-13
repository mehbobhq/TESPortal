// Test stand-in for lib/google-document-ai-provider.ts (which uses TypeScript syntax Node's strip-only mode cannot load).
// Constructing it fails loudly, so a test can prove a route never reached Document AI.
export class GoogleDocumentAIAcquisitionProvider {
  constructor() {
    throw new Error("Document AI provider must not be constructed in this test");
  }
}
