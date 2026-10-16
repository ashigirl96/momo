use security_framework::os::macos::keychain::SecKeychain;
use security_framework::os::macos::passwords::find_generic_password;

const SERVICE: &str = "momo-probe-vault";
const VARIANT: &str = env!("PROBE_VARIANT");

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (cmd, path) = (args[1].as_str(), args[2].as_str());
    let no_ui = args.iter().any(|a| a == "--no-ui");
    let account = std::env::var("PROBE_ACCOUNT").unwrap_or_else(|_| "root-key".into());
    let kc = SecKeychain::open(path).expect("open keychain");
    let _guard = if no_ui { Some(SecKeychain::disable_user_interaction().expect("disable ui")) } else { None };
    println!("variant={VARIANT} pid={} exe={}", std::process::id(), std::env::current_exe().unwrap().display());
    match cmd {
        "add" => match kc.set_generic_password(SERVICE, &account, b"0123456789abcdef0123456789abcdef") {
            Ok(()) => println!("add: ok"),
            Err(e) => { println!("add: err code={} {}", e.code(), e); std::process::exit(2) }
        },
        "read" => match find_generic_password(Some(&[kc]), SERVICE, &account) {
            Ok((pw, _)) => println!("read: ok len={}", pw.len()),
            Err(e) => { println!("read: err code={} {}", e.code(), e); std::process::exit(3) }
        },
        _ => unreachable!(),
    }
}
