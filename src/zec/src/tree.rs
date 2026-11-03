//! Simulated Orchard note-commitment tree (depth 32), built from the orchard crate's own
//! Sinsemilla node hash. Stands in for the chain's global commitment tree.
use incrementalmerkletree::{Hashable, Level};
use orchard::tree::{Anchor, MerkleHashOrchard, MerklePath};

pub const DEPTH: usize = 32;

fn levels(leaves: &[MerkleHashOrchard]) -> Vec<Vec<MerkleHashOrchard>> {
    let mut lv = vec![leaves.to_vec()];
    for l in 0..DEPTH {
        let cur = &lv[l];
        let e = MerkleHashOrchard::empty_root(Level::from(l as u8));
        let next: Vec<MerkleHashOrchard> = (0..(cur.len() + 1) / 2)
            .map(|i| MerkleHashOrchard::combine(Level::from(l as u8), &cur[2 * i], cur.get(2 * i + 1).unwrap_or(&e)))
            .collect();
        lv.push(next);
    }
    lv
}
pub fn root(leaves: &[MerkleHashOrchard]) -> Anchor {
    if leaves.is_empty() { return Anchor::empty_tree(); }
    Anchor::from(levels(leaves)[DEPTH][0])
}
pub fn path(leaves: &[MerkleHashOrchard], pos: usize) -> MerklePath {
    let lv = levels(leaves);
    let auth: [MerkleHashOrchard; DEPTH] = core::array::from_fn(|l| {
        let sib = (pos >> l) ^ 1;
        lv[l].get(sib).copied().unwrap_or_else(|| MerkleHashOrchard::empty_root(Level::from(l as u8)))
    });
    MerklePath::from_parts(pos as u32, auth)
}
