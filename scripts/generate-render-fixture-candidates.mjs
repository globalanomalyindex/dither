import { generateRenderFixtureCandidate } from "../tests/helpers/run-legacy-render-fixtures.mjs";

const candidate = await generateRenderFixtureCandidate();
process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
