const assert = require('node:assert/strict');
const { ProjectController } = require('../dist/project/project.controller');

function fixture() {
  const project = {
    id: 'project-1',
    tenantId: 'kaza-tenant-id',
    items: [],
    digitalTwin: {
      interpretation: {
        sourceFiles: [],
        environments: [{
          name: 'Cozinha',
          items: [{
            id: 'cozinha-ilha-01',
            environment: 'Cozinha',
            itemType: 'Ilha',
            description: 'Ilha central com cooktop',
            codigo: null,
            dimensions: { width: 3100, height: null, depth: 700, thickness: 18 },
            quantity: 1,
            materialType: 'MDF 18mm',
            color: null,
            finish: null,
            quoteStatus: 'PENDING_MEASUREMENTS',
            evidence: { source: 'ocr_layout', sourcePage: 4, notes: 'Cotas do PDF.' },
            validation: { issues: [] },
          }],
        }],
      },
    },
  };
  const created = [];
  let projectUpdate = null;
  const transactionClient = {
    projectItem: {
      deleteMany: async () => ({ count: created.length }),
      create: async ({ data }) => {
        created.push(data);
        return data;
      },
    },
    project: {
      update: async ({ data }) => {
        projectUpdate = data;
        return data;
      },
    },
  };
  const prisma = {
    project: { findFirst: async () => project },
    $transaction: async (callback) => callback(transactionClient),
  };
  return {
    controller: new ProjectController(prisma, {}),
    created,
    getProjectUpdate: () => projectUpdate,
  };
}

async function main() {
  const valid = fixture();
  const result = await valid.controller.updateProjectItemMeasurements(
    'Bearer mock-jwt-token-2026',
    'project-1',
    'pending-cozinha-ilha-01',
    { width: 3100, height: 940, depth: 700, thickness: 18, quantity: 1 },
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.measurements, { width: 3100, height: 940, depth: 700 });
  assert.equal(result.completeMeasurements, 1);
  assert.equal(result.pendingMeasurements, 0);
  assert.equal(valid.created.length, 1);
  assert.equal(valid.getProjectUpdate().digitalTwin.interpretation.environments[0].items[0].evidence.source, 'manual');

  const invalid = fixture();
  await assert.rejects(
    invalid.controller.updateProjectItemMeasurements(
      'Bearer mock-jwt-token-2026',
      'project-1',
      'cozinha-ilha-01',
      { width: 3100, height: 2740, depth: 700, thickness: 18, quantity: 1 },
    ),
    (error) => error && error.status === 422,
  );
  assert.equal(invalid.created.length, 0);
  console.log('manual measurements smoke test: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
