import os
import zipfile

def package_project():
    # Source directory (the parent of backend folder)
    src_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Destination ZIP path (save it in the parent of the project folder, which is Zadania-MSTeams)
    dest_zip_path = os.path.abspath(os.path.join(src_dir, "..", "PLC_ParkingProject_AlexK.zip"))
    
    print(f"Starting packaging from: {src_dir}")
    print(f"Creating ZIP archive at: {dest_zip_path}")
    
    # Exclude list (patterns to ignore)
    exclude_dirs = {".git", "venv", "__pycache__", ".vscode", ".idea", ".pytest_cache", "PKLot"}
    exclude_files = {".env", "PLC_ParkingProject_AlexK.zip"}
    
    zip_count = 0
    with zipfile.ZipFile(dest_zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for root, dirs, files in os.walk(src_dir):
            # Modify dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            for file in files:
                if file in exclude_files or file.endswith('.pyc') or file.endswith('.zip'):
                    continue
                
                full_path = os.path.join(root, file)
                # Compute relative path to preserve directory structure
                rel_path = os.path.relpath(full_path, src_dir)
                
                # Add to zip
                zip_file.write(full_path, rel_path)
                zip_count += 1
                
    print(f"Packaging complete. Bundled {zip_count} files successfully!")
    print(f"Output archive: {dest_zip_path}")

if __name__ == "__main__":
    package_project()
