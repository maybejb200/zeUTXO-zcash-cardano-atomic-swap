//! review4: cross-check step6 joint_keys() derivation lines (copied verbatim from src/main.rs L89-92 by script)
//! against independent zafe-core ZIP 2005 use_qsk vectors (published in ZcashFoundation frost-tools; "not official").
use ff::{FromUniformBytes, PrimeField};
use pasta_curves::pallas;
use orchard::keys::{FullViewingKey, Scope};
fn b2b(len: usize, pers: &[u8; 16], parts: &[&[u8]]) -> Vec<u8> {
    let mut st = blake2b_simd::Params::new().hash_length(len).personal(pers).to_state();
    for p in parts { st.update(p); }
    st.finalize().as_bytes().to_vec()
}
fn prf_expand(k: &[u8], t: &[&[u8]]) -> [u8; 64] {
    let mut parts: Vec<&[u8]> = vec![k]; parts.extend_from_slice(t);
    b2b(64, b"Zcash_ExpandSeed", &parts).try_into().unwrap()
}
fn h(s:&str)->Vec<u8>{hex::decode(s).unwrap()}
fn main(){
  // (sk, ak, nk, qsk, qk, rivk_ext, default_address_raw)
  let v = [
   ("202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f","b6c6ed12bf8de427e60a72615e3ef838cd90572bb3a7b87cd92a928e4c959924","c3e108702d8eab6e18289d40ec275ad48723d6f1bd9a0e5bdc35f56d8126820b","d2f191d5316a447c9b3695168b6a199ea5bfa9d6c1ee538c34cc3e6c72207092","ebee3906d5b8219fb1c88df7717fc12bf70875fa3cb32574e5d2f515e3cd4a76","bdfd6c44d326a9afe81584d21d8f56977abb12fea2c26f8fa24c22d88e0ffd28","d9b23a14a50162cad471ff9763b17ae8ec4bb19b0a29b9044b7bd5acdc6b3342af4400efef655b4f4903bc"),
   ("404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f","7199cb8dcad65ac39e07845e6e90dad3db3678d0d94ad5319fb9cc480b799a2c","4dab5080d322b5edbe965f14eb9018cf1ae45fcebd2bec18d0b14aa2b9ca550a","55c38ef2db8674e006602899e59c9b596a3a443cb5401933a64a9177028e5fe3","c4441905e40aaebd8612340e58937c30d8c5c3facbfdd3a449900b13309f3411","dbefd1758ed49ad4407e0dd2b7f9817183cef03d2d1c6c089867d02e9d87840e","fe29361e29da0dc82e374aebb34b210fe5c8af689dbdacef5b1aa6aeca896bab2f6e6a325f9ffaa1ae2d9a"),
  ];
  let mut allok = true;
  for (i,(sks,aks,nks,qsks,qks,rivks,addrs)) in v.iter().enumerate(){
    let sk: [u8;32] = h(sks).try_into().unwrap(); let ak: [u8;32] = h(aks).try_into().unwrap(); let ak = &ak;
    let nk = pallas::Base::from_uniform_bytes(&prf_expand(&sk, &[&[0x07]]));
    let qsk: [u8; 32] = prf_expand(&sk, &[&[0x0C]])[..32].try_into().unwrap();
    let qk: [u8; 32] = blake3::derive_key("Zcash ZIP 2005 qk-derivation v1", &qsk);
    let rivk = pallas::Scalar::from_uniform_bytes(&prf_expand(&qk, &[&[0x0D], ak, &nk.to_repr()]));
    let mut fb=[0u8;96]; fb[..32].copy_from_slice(ak); fb[32..64].copy_from_slice(&nk.to_repr()); fb[64..].copy_from_slice(&rivk.to_repr());
    let fvk = FullViewingKey::from_bytes(&fb).expect("fvk");
    let addr = hex::encode(fvk.address_at(0u32, Scope::External).to_raw_address_bytes());
    let r = [hex::encode(nk.to_repr())==*nks, hex::encode(qsk)==*qsks, hex::encode(qk)==*qks, hex::encode(rivk.to_repr())==*rivks, addr==*addrs];
    println!("vector {}: nk {} qsk {} qk {} rivk_ext {} default_addr {}", i+2, r[0],r[1],r[2],r[3],r[4]);
    allok &= r.iter().all(|x|*x);
  }
  println!("{}", if allok {"ALL MATCH"} else {"MISMATCH"});
  if !allok { std::process::exit(1) }
}
