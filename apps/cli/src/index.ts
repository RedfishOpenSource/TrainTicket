import { once } from 'node:events';
import { toErrorMessage, type QueryInput } from '@train-ticket/core';
import { queryBestRecommendation } from '@train-ticket/adapter-12306';

function parseArgs(argv: string[]): QueryInput {
  const [travelDate, departureCity, arrivalCity] = argv;
  if (!travelDate || !departureCity || !arrivalCity) {
    throw new Error('Usage: pnpm dev:cli -- <travelDate> <departureCity> <arrivalCity>');
  }

  return {
    travelDate,
    departureCity,
    arrivalCity,
  };
}

async function writeOutput(text: string): Promise<void> {
  if (process.stdout.write(text)) {
    return;
  }

  await once(process.stdout, 'drain');
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
  const input = parseArgs(rawArgs);
  const result = await queryBestRecommendation(input);
  await writeOutput(`${JSON.stringify(result, null, 2)}\n`);
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }

  throw error;
});

main().catch((error: unknown) => {
  process.stderr.write(`${toErrorMessage(error)}\n`);
  process.exit(1);
});
