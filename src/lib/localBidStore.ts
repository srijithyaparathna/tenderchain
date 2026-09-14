export interface LocalSealedBid {
  documentsHash: string;
  priceLineItems: { id: string; description: string; qty: number; unitPrice: number }[];
  salt: string;
  totalPrice: number;
  commitmentHash: string;
}

const key = (tenderId: string, bidder: string) => `tenderchain:sealedbid:${tenderId}:${bidder}`;

/**
 * The bidder's own salt/documents/price are kept ONLY in this browser's
 * localStorage. They are never transmitted until the Reveal step — losing
 * this data before revealing means the bid cannot be proven and is forfeit.
 */
export function saveLocalSealedBid(tenderId: string, bidder: string, data: LocalSealedBid) {
  try {
    localStorage.setItem(key(tenderId, bidder), JSON.stringify(data));
  } catch {
    /* storage unavailable — the UI already warns the user to record their salt */
  }
}

export function loadLocalSealedBid(tenderId: string, bidder: string): LocalSealedBid | null {
  try {
    const raw = localStorage.getItem(key(tenderId, bidder));
    return raw ? (JSON.parse(raw) as LocalSealedBid) : null;
  } catch {
    return null;
  }
}

export function clearLocalSealedBid(tenderId: string, bidder: string) {
  try {
    localStorage.removeItem(key(tenderId, bidder));
  } catch {
    /* ignore */
  }
}
