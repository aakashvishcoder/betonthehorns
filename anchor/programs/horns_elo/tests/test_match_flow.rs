use {
    anchor_lang::{
        prelude::{AccountMeta, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    horns_elo::{
        constants::{CONFIG_SEED, MATCH_SEED, PLAYER_SEED},
        state::{GameMode, Match, PlayerRating},
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

fn rating_key(wallet: &Pubkey, mode: GameMode) -> Pubkey {
    pda(&[PLAYER_SEED, wallet.as_ref(), &mode.seed()])
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

fn register_ix(wallet: Pubkey, mode: GameMode) -> Instruction {
    Instruction::new_with_bytes(
        horns_elo::id(),
        &horns_elo::instruction::RegisterPlayer { mode }.data(),
        horns_elo::accounts::RegisterPlayer {
            wallet,
            player: rating_key(&wallet, mode),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn create_match_ix(
    signer: Pubkey,
    id: u64,
    mode: GameMode,
    players: Vec<Pubkey>,
    commitment: [u8; 32],
) -> Instruction {
    Instruction::new_with_bytes(
        horns_elo::id(),
        &horns_elo::instruction::CreateMatch { mode, players, seed_commitment: commitment }.data(),
        horns_elo::accounts::CreateMatch {
            result_authority: signer,
            config: pda(&[CONFIG_SEED]),
            game: pda(&[MATCH_SEED, &id.to_le_bytes()]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// `ratings` are the rating accounts passed as remaining accounts, in order.
fn settle_ix(signer: Pubkey, id: u64, ratings: &[Pubkey], places: Vec<u8>, seed: [u8; 32]) -> Instruction {
    let mut accounts = horns_elo::accounts::SettleMatch {
        result_authority: signer,
        config: pda(&[CONFIG_SEED]),
        game: pda(&[MATCH_SEED, &id.to_le_bytes()]),
    }
    .to_account_metas(None);
    accounts.extend(ratings.iter().map(|k| AccountMeta::new(*k, false)));
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
fn match_flow_updates_elo_per_mode_and_checks_seed() {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/horns_elo.so"));
    svm.add_program(horns_elo::id(), bytes).unwrap();

    let admin = Keypair::new();
    let server = Keypair::new();
    let players: Vec<Keypair> = (0..4).map(|_| Keypair::new()).collect();
    for kp in [&admin, &server].into_iter().chain(&players) {
        svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
    }
    let wallets: Vec<Pubkey> = players.iter().map(|p| p.pubkey()).collect();
    let four = GameMode::Four;

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
        assert!(send(&mut svm, register_ix(p.pubkey(), four), p));
    }
    // Player 0 also has a 1v1 rating, which a 4-player result must not touch.
    assert!(send(&mut svm, register_ix(wallets[0], GameMode::HeadsUp), &players[0]));
    // Registering the same mode twice fails (account already exists).
    assert!(!send(&mut svm, register_ix(wallets[0], four), &players[0]));

    let seed = [42u8; 32];
    let commitment = hash(&seed).to_bytes();

    assert!(!send(&mut svm, create_match_ix(admin.pubkey(), 0, four, wallets.clone(), commitment), &admin));
    let dupes = vec![wallets[0], wallets[0], wallets[1], wallets[2]];
    assert!(!send(&mut svm, create_match_ix(server.pubkey(), 0, four, dupes, commitment), &server));
    // Player count must match the mode.
    assert!(!send(&mut svm, create_match_ix(server.pubkey(), 0, four, wallets[..3].to_vec(), commitment), &server));
    assert!(!send(&mut svm, create_match_ix(server.pubkey(), 0, GameMode::HeadsUp, wallets.clone(), commitment), &server));
    assert!(send(&mut svm, create_match_ix(server.pubkey(), 0, four, wallets.clone(), commitment), &server));

    let ratings: Vec<Pubkey> = wallets.iter().map(|w| rating_key(w, four)).collect();
    let places = vec![2, 1, 3, 4];
    assert!(!send(&mut svm, settle_ix(server.pubkey(), 0, &ratings, places.clone(), [0; 32]), &server));
    assert!(!send(&mut svm, settle_ix(admin.pubkey(), 0, &ratings, places.clone(), seed), &admin));
    let swapped = [ratings[1], ratings[0], ratings[2], ratings[3]];
    assert!(!send(&mut svm, settle_ix(server.pubkey(), 0, &swapped, places.clone(), seed), &server));
    // A rating account from another mode is rejected.
    let wrong_mode = [rating_key(&wallets[0], GameMode::HeadsUp), ratings[1], ratings[2], ratings[3]];
    assert!(!send(&mut svm, settle_ix(server.pubkey(), 0, &wrong_mode, places.clone(), seed), &server));

    assert!(send(&mut svm, settle_ix(server.pubkey(), 0, &ratings, places.clone(), seed), &server));
    let after: Vec<PlayerRating> = ratings.iter().map(|k| read(&svm, *k)).collect();
    assert_eq!(after.iter().map(|r| r.rating).collect::<Vec<_>>(), vec![1205, 1216, 1195, 1184]);
    assert_eq!(after.iter().map(|r| (r.games, r.wins)).collect::<Vec<_>>(), vec![(1, 0), (1, 1), (1, 0), (1, 0)]);
    assert!(after.iter().all(|r| r.mode == four));

    let heads_up: PlayerRating = read(&svm, rating_key(&wallets[0], GameMode::HeadsUp));
    assert_eq!((heads_up.rating, heads_up.games), (1200, 0));

    let game: Match = read(&svm, pda(&[MATCH_SEED, &0u64.to_le_bytes()]));
    assert!(game.settled && game.mode == four);
    assert_eq!(game.revealed_seed, seed);
    assert_eq!(game.places, places);

    assert!(!send(&mut svm, settle_ix(server.pubkey(), 0, &ratings, vec![1, 2, 3, 4], seed), &server));
}
