const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectController } = require('../dist/project/project.controller');

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'woodflow-document-viewer-'));
  process.env.PROJECT_UPLOAD_DIR = uploadRoot;
  const projectId = 'project-viewer-1';
  const directory = path.join(uploadRoot, projectId);
  const contents = Buffer.from('%PDF-1.4\nviewer smoke test\n');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, '01-projeto.pdf'), contents);

  const project = {
    id: projectId,
    tenantId: 'kaza-tenant-id',
    digitalTwin: {
      sourceDocuments: [{
        filename: 'Projeto técnico.pdf',
        mimeType: 'application/pdf',
        storageKey: '01-projeto.pdf',
        pages: 3,
      }],
    },
  };
  const prisma = { project: { findFirst: async () => project } };
  const controller = new ProjectController(prisma, {});

  try {
    const documents = await controller.getProjectDocuments('Bearer mock-jwt-token-2026', projectId);
    assert.equal(documents.length, 1);
    assert.equal(documents[0].filename, 'Projeto técnico.pdf');
    assert.equal(documents[0].available, true);
    assert.equal(documents[0].viewable, true);
    assert.equal(Object.hasOwn(documents[0], 'storageKey'), false);

    const headers = {};
    const response = { setHeader: (name, value) => { headers[name] = value; } };
    const file = await controller.viewProjectDocument(
      'Bearer mock-jwt-token-2026',
      projectId,
      '0',
      response,
    );
    assert.equal(headers['Content-Type'], 'application/pdf');
    assert.match(headers['Content-Disposition'], /^inline;/);
    assert.deepEqual(await readStream(file.getStream()), contents);

    project.digitalTwin.sourceDocuments[0].storageKey = '../outside.pdf';
    await assert.rejects(
      controller.viewProjectDocument('Bearer mock-jwt-token-2026', projectId, '0', response),
      (error) => error && error.status === 404,
    );
    console.log('document viewer smoke test: ok');
  } finally {
    fs.rmSync(uploadRoot, { recursive: true, force: true });
    delete process.env.PROJECT_UPLOAD_DIR;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
