// replicate.js — one function for calling any Replicate model through the
// ITP/IMA class proxy (no API key in the client), with retries.

const REPLICATE_PROXY_URL = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(model, input) {
  const response = await fetch(REPLICATE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) throw new Error(`the proxy responded with ${response.status}`);

  const prediction = await response.json();
  if (prediction.error) throw new Error(prediction.details || prediction.error);
  if (prediction.output === undefined || prediction.output === null) {
    throw new Error("Replicate didn't return any output");
  }
  return prediction.output;
}

// Returns the model's `output`, retrying on transient proxy failures.
export async function runModel(model, input, onRetry) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runOnce(model, input);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        if (onRetry) onRetry(attempt);
        await wait(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}
