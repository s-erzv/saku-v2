export function generateOrderId(userId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `SAKU-${userId}-${timestamp}-${random}`.toUpperCase();
}

export function parseOrderId(orderId: string) {
  const parts = orderId.split('-');
  return {
    prefix: parts[0],
    userId: parts[1],
    timestamp: parts[2],
    random: parts[3],
  };
}
