// Balance Threshold ZK Circuit
// Proves that actual_balance > threshold without revealing actual_balance

fn main(actual_balance: u64, threshold: pub u64) {
    assert(actual_balance > threshold);
}
