use {
    anchor_lang::{
        prelude::{AccountMeta, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    horns_elo::{
        constants::{CONFIG_SEED, MATCH_SEED, PLAYER_SEED},
        state::{Match, PlayerRating},
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &horns_elo::id()).0
}

fn send(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) -> bool {
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    let ok = svm.send_transaction(tx).is_ok();
    svm.expire_blockhash();
    ok
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, key: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&key).unwrap().data.as_slice()).unwrap()
}

fn create_match_ix(signer: Pubkey, id: u64, players: Vec<Pubkey>, commitment: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(
        horns_elo::id(),
        &horns_elo::instruction::CreateMatch { players, seed_commitment: commitment }.data(),
        horns_elo::accounts::CreateMatch {
            result_authority: signer,
            config: pda(&[CONFIG_SEED]),
            game: pda(&[MATCH_SEED, &id.to_le_bytes()]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn settle_ix(signer: Pubkey, id: u64, players: &[Pubkey], places: Vec<u8>, seed: [u8; 32]) -> Instruction {
    let mut accounts = horns_elo::accounts::SettleMatch {
        result_authority: signer,
        config: pda(&[CONFIG_SEED]),
        game: pda(&[MATCH_SEED, &id.to_le_bytes()]),
    }
    .to_account_metas(None);
    accounts.extend(players.iter().map(|w| AccountMeta::new(pda(&[PLAYER_SEED, w.as_ref()]), false)));
    Instruction::new_with_bytes(
        horns_elo::id(),
        &horns_elo::instruction::SettleMatch {
            places,
            revealed_seed: seed,
            chip_counts_hash: [7; 32],
        }
        .data(),
        accounts,
    )
}

#[test]
fn match_flow_updates_elo_and_checks_seed() {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/horns_elo.so"));
    svm.add_program(horns_elo::id(), bytes).unwrap();

    let admin = Keypair::new();
    let server = Keypair::new();
    let players: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
    for kp in [&admin, &server].into_iter().chain(&players) {
        svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
    }
    let wallets: Vec<Pubkey> = players.iter().map(|p| p.pubkey()).collect();

    // Setup: config with the server as result authority, three registered players.
    let init = Instruction::new_with_bytes(
        horns_elo::id(),
        &horns_elo::instruction::Initialize { result_authority: server.pubkey() }.data(),
        horns_elo::accounts::Initialize {
            admin: admin.pubkey(),
            config: pda(&[CONFIG_SEED]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, init, &admin));
    for p in &players {
        let ix = Instruction::new_with_bytes(
            horns_elo::id(),
            &horns_elo::instruction::RegisterPlayer {}.data(),
            horns_elo::accounts::RegisterPlayer {
                wallet: p.pubkey(),
                player: pda(&[PLAYER_SEED, p.pubkey().as_ref()]),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        assert!(send(&mut svm, ix, p));
    }

    let seed = [42u8; 32];
    let commitment = hash(&seed).to_bytes();

    // Only the server key may open matches.
    assert!(!send(&mut svm, create_match_ix(admin.pubkey(), 0, wallets.clone(), commitment), &admin));
    // Duplicate players are rejected.
    let dupes = vec![wallets[0], wallets[0]];
    assert!(!send(&mut svm, create_match_ix(server.pubkey(), 0, dupes, commitment), &server));
    assert!(send(&mut svm, create_match_ix(server.pubkey(), 0, wallets.clone(), commitment), &server));

    // A wrong seed reveal or a non-server signer can't settle.
    assert!(!send(&mut svm, settle_ix(server.pubkey(), 0, &wallets, vec![2, 1, 3], [0; 32]), &server));
    assert!(!send(&mut svm, settle_ix(admin.pubkey(), 0, &wallets, vec![2, 1, 3], seed), &admin));
    // Player accounts must be passed in match order.
    let swapped = [wallets[1], wallets[0], wallets[2]];
    assert!(!send(&mut svm, settle_ix(server.pubkey(), 0, &swapped, vec![2, 1, 3], seed), &server));

    // Player 1 wins, player 0 second, player 2 third; all start at 1200.
    assert!(send(&mut svm, settle_ix(server.pubkey(), 0, &wallets, vec![2, 1, 3], seed), &server));
    let ratings: Vec<PlayerRating> = wallets
        .iter()
        .map(|w| read(&svm, pda(&[PLAYER_SEED, w.as_ref()])))
        .collect();
    assert_eq!(ratings.iter().map(|r| r.rating).collect::<Vec<_>>(), vec![1200, 1216, 1184]);
    assert_eq!(ratings.iter().map(|r| r.games).collect::<Vec<_>>(), vec![1, 1, 1]);
    assert_eq!(ratings.iter().map(|r| r.wins).collect::<Vec<_>>(), vec![0, 1, 0]);

    let game: Match = read(&svm, pda(&[MATCH_SEED, &0u64.to_le_bytes()]));
    assert!(game.settled);
    assert_eq!(game.revealed_seed, seed);
    assert_eq!(game.places, vec![2, 1, 3]);

    // Settling twice is rejected.
    assert!(!send(&mut svm, settle_ix(server.pubkey(), 0, &wallets, vec![1, 2, 3], seed), &server));
}
