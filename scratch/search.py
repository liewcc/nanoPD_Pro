import os

def search_in_dir(directory, keyword):
    print(f"Searching for '{keyword}' in {directory}:")
    for root, dirs, files in os.walk(directory):
        if ".venv" in root or "node_modules" in root or ".git" in root:
            continue
        for file in files:
            if file.endswith(('.py', '.js', '.html', '.css', '.md')):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        for idx, line in enumerate(f, 1):
                            if keyword.lower() in line.lower():
                                print(f"{filepath}:{idx}: {line.strip()[:100]}")
                except Exception as e:
                    pass

search_in_dir(r"d:\AI\nanoPD", "registerInternetMsg")
search_in_dir(r"d:\AI\nanoPD", "register_internet")
search_in_dir(r"d:\AI\nanoPD", "register_cellular")
