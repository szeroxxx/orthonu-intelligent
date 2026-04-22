import { GraphQLClient } from 'graphql-request';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { dentiraTokenManager } from './token-manager.js';
import { DentiraError } from '../lib/errors.js';
import type {
  CreateTemplatePrescriptionInput,
  PrescriptionResponse,
  UpdateVendorOrderInput,
  OrderUpdateResponse,
} from './types.js';

const GRAPHQL_URL = `${config.DENTIRA_BASE_URL}/graphql`;
const MAX_RETRIES = 3;

const CREATE_PRESCRIPTION_MUTATION = /* GraphQL */ `
  mutation CreateTemplatePrescription($input: CreateTemplatePrescriptionInput!) {
    createTemplatePrescription(input: $input) {
      id
      patientEmail
      patientName
      notes
      prescriptionCode
      createdAt
      status
      qrImageUrl
      pdfFileUrl
      doctorId
      patientId
      prescriptionProducts {
        id
        dosage
        frequency
        duration
        additionalNotes
        packagingQuantity
        allowPackagingVariation
        variant {
          id
          concentration
          packaging
          packagingUom
          msrp
          wholesalePrice
          sku
          product {
            id
            name
            description
            manufacturerId
            manufacturerName
            supplier
            requiresPrescription
            category { name }
          }
        }
        handwrittenProduct {
          productName
          concentration
        }
      }
    }
  }
`;

const UPDATE_ORDER_MUTATION = /* GraphQL */ `
  mutation UpdateVendorOrderById($updateOrderInput: UpdateVendorOrderInput!) {
    updateVendorOrder(updateOrderInput: $updateOrderInput) {
      id
      status
      trackingInfo
      cancellationReason
      taxAmount
    }
  }
`;

function buildClient(token: string): GraphQLClient {
  return new GraphQLClient(GRAPHQL_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function executeWithRetry<T>(
  operation: (client: GraphQLClient) => Promise<T>,
  operationName: string,
): Promise<T> {
  let lastError: unknown;
  let forceRefreshed = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const token = await dentiraTokenManager.getToken();
    const client = buildClient(token);

    try {
      const result = await operation(client);
      return result;
    } catch (err: unknown) {
      lastError = err;

      const isAuthError = isHttpError(err, 401) || isHttpError(err, 403);
      if (isAuthError && !forceRefreshed) {
        logger.warn({ operationName }, 'Got 401/403 from Dentira — force-refreshing token once');
        await dentiraTokenManager.forceRefresh();
        forceRefreshed = true;
        continue;
      }

      const is5xx = isHttpError(err, 500) || isHttpError(err, 502) || isHttpError(err, 503);
      if (is5xx && attempt < MAX_RETRIES) {
        const delay = 2 ** (attempt - 1) * 500;
        logger.warn({ operationName, attempt, delay }, 'Dentira 5xx — retrying with backoff');
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  logger.error({ operationName, err: lastError }, 'Dentira GraphQL call failed');
  throw new DentiraError(`Dentira ${operationName} failed`, lastError);
}

function isHttpError(err: unknown, status: number): boolean {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { status?: number } }).response;
    return r?.status === status;
  }
  return false;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function createTemplatePrescription(
  input: CreateTemplatePrescriptionInput,
): Promise<PrescriptionResponse['createTemplatePrescription']> {
  logger.debug({ variantCount: input.prescriptionProducts.length }, 'createTemplatePrescription');

  const result = await executeWithRetry<PrescriptionResponse>(
    client => client.request(CREATE_PRESCRIPTION_MUTATION, { input }),
    'createTemplatePrescription',
  );

  logger.debug({ prescriptionId: result.createTemplatePrescription.id }, 'Prescription created');
  return result.createTemplatePrescription;
}

export async function updateVendorOrder(
  updateOrderInput: UpdateVendorOrderInput,
): Promise<OrderUpdateResponse['updateVendorOrder']> {
  logger.debug({ vendorOrderId: updateOrderInput.vendorOrderId, status: updateOrderInput.status }, 'updateVendorOrder');

  const result = await executeWithRetry<OrderUpdateResponse>(
    client => client.request(UPDATE_ORDER_MUTATION, { updateOrderInput }),
    'updateVendorOrder',
  );

  return result.updateVendorOrder;
}
