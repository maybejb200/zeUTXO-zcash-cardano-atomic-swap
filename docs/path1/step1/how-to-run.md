# zeUTXO path 1: how to run (all on the box, throwaway keys only)
- Model: `cd model && python3 foc_model.py && python3 sweep.py && python3 classify_unbounded.py` takes about 10 s. Outputs are model_output.txt, results.json, sweep_output.txt and unbounded_classification.txt.
- Test (a) Orchard split-key signing: `cd test_a_orchard && cargo build --release && ./target/release/test_a_orchard 64`. Output goes to run_output.txt.
- Test (b) Cross-group DLEQ: `cd test_b_dleq && cargo build --release && ./target/release/test_b_dleq 200`. It takes about 3.5 min and writes run_output.txt. The earlier run_output_v1_buggy_F7_harness.txt is the first run, made before I fixed the harness; it is kept for honesty.
- Test (c) Aiken: `cd test_c_aiken && /workspace/tools/aiken-x86_64-unknown-linux-musl/aiken check`. Output goes to check_output.json and units_table.txt.
