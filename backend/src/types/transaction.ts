export interface PreparedTransaction {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description?: string;
}

export interface TransactionBundle {
  steps: PreparedTransaction[];
  totalSteps: number;
  summary: string;
}
