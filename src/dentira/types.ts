// ── GraphQL mutation input types ───────────────────────────────────────────────

export interface PrescriptionProductInput {
  variantId: string;
  dosage: number;
  frequency: number;
  duration: number;
  additionalNotes: string;   // frequency code e.g. "[FREQ_CODE:OD]"
  takeWith?: string;
  allowPackagingVariation?: boolean;
  templateId?: string | null;
}

export interface CreateTemplatePrescriptionInput {
  patientEmail: string;
  patientName: string;
  notes?: string;
  prescriptionProducts: PrescriptionProductInput[];
}

export interface UpdateVendorOrderInput {
  vendorOrderId: string;
  status: 'ACKNOWLEDGED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  taxAmount?: number;
  trackingInfo?: string;
  cancellationReason?: string;
}

// ── GraphQL response types ─────────────────────────────────────────────────────

export interface PrescriptionResponse {
  createTemplatePrescription: {
    id: string;
    patientEmail: string;
    patientName: string;
    notes: string | null;
    prescriptionCode: string | null;
    createdAt: string;
    status: string;
    qrImageUrl: string | null;
    pdfFileUrl: string | null;
    doctorId: string | null;
    patientId: string | null;
    prescriptionProducts: Array<{
      id: string;
      dosage: number;
      frequency: number;
      duration: number;
      additionalNotes: string | null;
      packagingQuantity: number | null;
      allowPackagingVariation: boolean;
      variant: {
        id: string;
        concentration: string | null;
        packaging: number | null;
        packagingUom: string | null;
        msrp: number | null;
        wholesalePrice: number | null;
        sku: string | null;
        product: {
          id: string;
          name: string;
          description: string | null;
          manufacturerId: string | null;
          manufacturerName: string | null;
          supplier: string | null;
          requiresPrescription: boolean;
          category: { name: string } | null;
        };
      } | null;
      handwrittenProduct: { productName: string; concentration: string | null } | null;
    }>;
  };
}

export interface OrderUpdateResponse {
  updateVendorOrder: {
    id: string;
    status: string;
    trackingInfo: string | null;
    cancellationReason: string | null;
    taxAmount: number | null;
  };
}

// ── Webhook order payload ──────────────────────────────────────────────────────

export interface WebhookOrderPayload {
  order: {
    id: string;
    status: string;
    shippingMethod: string;
    createdAt: string;
    orderDate: string;
    orderCode: string;
    subTotal: number;
    orderPayment: {
      status: string;
      subTotal: number;
      total: number;
      tax: number | null;
    };
    orderItems: Array<{
      id: string;
      variantId: string;
      quantity: number;
      unitPrice: number;
      prescriptionId: string;
      status: string;
      productVariant: {
        id: string;
        concentration: string | null;
        packaging: number | null;
        packagingUom: string | null;
        imageUrl: string | null;
        product: { name: string; manufacturerName: string };
      };
    }>;
    patient: { name: string; email: string };
    shippingAddress: {
      city: string;
      addressLine1: string;
      state: string;
      country: string;
      postalCode: string;
      contactPhone: string;
    };
  };
}
