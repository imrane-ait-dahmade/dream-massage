import { Router } from 'express';
import type { Request, Response } from 'express';
import { devScenariosService } from './dev-scenarios.service';
import { handleError } from '../../utils/controller-helpers';

const router = Router();

const SCENARIOS = [
  'normal_day',
  'prime_bonus_matin',
  'prime_bonus_soir',
  'anomalies_day',
  'correction_demo',
  'auto_shift_demo',
  'full_demo_day',
] as const;

type ScenarioName = (typeof SCENARIOS)[number];

// GET /api/dev/demo/scenarios
router.get('/scenarios', (_req: Request, res: Response) => {
  res.json({ ok: true, scenarios: SCENARIOS });
});

// GET /api/dev/demo/test-summary
router.get('/test-summary', (_req: Request, res: Response) => {
  devScenariosService
    .getTestSummary()
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err, 'Failed to compute test summary'));
});

// POST /api/dev/demo/reset-demo-data
router.post('/reset-demo-data', (_req: Request, res: Response) => {
  devScenariosService
    .resetDemoData()
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err, 'Failed to reset demo data'));
});

// POST /api/dev/demo/scenarios/run
router.post('/scenarios/run', (req: Request, res: Response) => {
  const { scenario } = req.body as { scenario?: unknown };

  if (typeof scenario !== 'string' || !(SCENARIOS as readonly string[]).includes(scenario)) {
    res.status(400).json({
      ok:    false,
      error: `scenario must be one of: ${SCENARIOS.join(', ')}`,
    });
    return;
  }

  const run = (): Promise<unknown> => {
    switch (scenario as ScenarioName) {
      case 'normal_day':        return devScenariosService.scenarioNormalDay();
      case 'prime_bonus_matin': return devScenariosService.scenarioPrimeBonusMatin();
      case 'prime_bonus_soir':  return devScenariosService.scenarioPrimeBonusSoir();
      case 'anomalies_day':     return devScenariosService.scenarioAnomaliesDay();
      case 'correction_demo':   return devScenariosService.scenarioCorrectionDemo();
      case 'auto_shift_demo':   return devScenariosService.scenarioAutoShiftDemo();
      case 'full_demo_day':     return devScenariosService.scenarioFullDemoDay();
    }
  };

  run()
    .then((result) => res.json({ ok: true, result }))
    .catch((err) => handleError(res, err, `Failed to run scenario: ${scenario}`));
});

// POST /api/dev/demo/chairs/:chairName/reading
// Injects a power reading by chair name (e.g. "F1") instead of UUID.
router.post('/chairs/:chairName/reading', (req: Request, res: Response) => {
  const { chairName } = req.params;
  const { powerWatts, isOnline, relayIsOn } = req.body as {
    powerWatts?: unknown;
    isOnline?:   unknown;
    relayIsOn?:  unknown;
  };

  if (typeof powerWatts !== 'number' || typeof isOnline !== 'boolean') {
    res.status(400).json({
      ok:    false,
      error: 'Body must have powerWatts: number and isOnline: boolean',
    });
    return;
  }

  devScenariosService
    .injectChairReading(
      chairName,
      powerWatts,
      isOnline,
      typeof relayIsOn === 'boolean' ? relayIsOn : undefined,
    )
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err, `Failed to inject reading for chair: ${chairName}`));
});

export default router;
