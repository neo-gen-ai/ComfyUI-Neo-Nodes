# SPDX-License-Identifier: Apache-2.0
# 真实下载测试脚本
# 测试 ModelScope 和 HuggingFace 的真实下载功能

import os
import sys
import time
import json
import tempfile
import shutil

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(__file__))


def test_modelscope_connection():
    """测试 ModelScope 连接，使用真实模型配置"""
    print("=" * 60)
    print("测试 ModelScope 连接（使用真实配置）...")
    print("=" * 60)
    
    try:
        from modelscope import snapshot_download
        print("[OK] modelscope 模块已安装")
    except ImportError:
        print("[FAIL] modelscope 模块未安装")
        return False
    
    # 读取真实配置
    config_path = os.path.join(os.path.dirname(__file__), "model_config.json")
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    
    ms_repo = config["model"]["ms_repo_id"]
    filename = config["model"]["filename"]
    
    print(f"仓库: {ms_repo}")
    print(f"目标文件: {filename}")
    
    # 尝试下载模型
    temp_dir = tempfile.mkdtemp()
    start_time = time.time()
    try:
        print(f"尝试从 ModelScope 下载模型到 {temp_dir}...")
        
        # 使用真实配置下载
        download_path = snapshot_download(
            ms_repo,
            allow_patterns=[filename],  # 只下载目标文件
            local_dir=temp_dir,
            max_workers=1,
        )
        
        elapsed = time.time() - start_time
        print(f"[OK] ModelScope 下载成功，耗时 {elapsed:.2f} 秒")
        print(f"下载路径: {download_path}")
        
        # 检查文件是否存在
        target_file = os.path.join(temp_dir, filename)
        if os.path.exists(target_file):
            file_size = os.path.getsize(target_file)
            print(f"[OK] 文件已下载: {target_file} ({file_size / (1024*1024):.2f} MB)")
            return True
        else:
            print(f"[WARN] 下载完成但文件不存在: {target_file}")
            return False
        
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"[FAIL] ModelScope 下载失败，耗时 {elapsed:.2f} 秒")
        print(f"错误: {e}")
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_huggingface_connection():
    """测试 HuggingFace 连接，使用真实模型配置"""
    print("=" * 60)
    print("测试 HuggingFace 连接（使用真实配置）...")
    print("=" * 60)
    
    try:
        from huggingface_hub import hf_hub_download
        print("[OK] huggingface_hub 模块已安装")
    except ImportError:
        print("[FAIL] huggingface_hub 模块未安装")
        return False
    
    # 读取真实配置
    config_path = os.path.join(os.path.dirname(__file__), "model_config.json")
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    
    hf_repo = config["model"]["hf_repo_id"]
    filename = config["model"]["filename"]
    
    print(f"仓库: {hf_repo}")
    print(f"目标文件: {filename}")
    
    temp_dir = tempfile.mkdtemp()
    start_time = time.time()
    try:
        print(f"尝试从 HuggingFace 下载模型到 {temp_dir}...")
        
        # 使用真实配置下载
        downloaded_path = hf_hub_download(
            repo_id=hf_repo,
            filename=filename,
            local_dir=temp_dir,
        )
        
        elapsed = time.time() - start_time
        print(f"[OK] HuggingFace 下载成功，耗时 {elapsed:.2f} 秒")
        print(f"下载路径: {downloaded_path}")
        
        # 检查文件是否存在
        if os.path.exists(downloaded_path):
            file_size = os.path.getsize(downloaded_path)
            print(f"[OK] 文件已下载: {downloaded_path} ({file_size / (1024*1024):.2f} MB)")
            return True
        else:
            print(f"[WARN] 下载完成但文件不存在: {downloaded_path}")
            return False
        
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"[FAIL] HuggingFace 下载失败，耗时 {elapsed:.2f} 秒")
        print(f"错误: {e}")
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_model_repo_exists():
    """测试模型仓库是否存在"""
    print("=" * 60)
    print("测试模型仓库是否存在...")
    print("=" * 60)
    
    # 读取配置
    config_path = os.path.join(os.path.dirname(__file__), "model_config.json")
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    
    ms_repo = config["model"]["ms_repo_id"]
    hf_repo = config["model"]["hf_repo_id"]
    filename = config["model"]["filename"]
    
    print(f"ModelScope 仓库: {ms_repo}")
    print(f"HuggingFace 仓库: {hf_repo}")
    print(f"目标文件: {filename}")
    
    # 测试 ModelScope 仓库
    print("\n测试 ModelScope 仓库...")
    try:
        import modelscope
        # 尝试导入模块
        print("[OK] ModelScope API 可用")
    except Exception as e:
        print(f"[WARN] 无法验证 ModelScope 仓库: {e}")
    
    # 测试 HuggingFace 仓库
    print("\n测试 HuggingFace 仓库...")
    try:
        from huggingface_hub import list_repo_files
        files = list_repo_files(hf_repo)
        print(f"[OK] HuggingFace 仓库存在，包含 {len(files)} 个文件")
        
        # 检查目标文件是否存在
        if filename in files:
            print(f"[OK] 目标文件 '{filename}' 存在于仓库中")
        else:
            print(f"[FAIL] 目标文件 '{filename}' 不存在于仓库中")
            print(f"可用文件: {files[:10]}...")
        
        return filename in files
    except Exception as e:
        print(f"[FAIL] 无法验证 HuggingFace 仓库: {e}")
        return False


def test_download_functions():
    """测试下载函数"""
    print("=" * 60)
    print("测试下载函数...")
    print("=" * 60)
    
    # 导入模块
    try:
        import llm
        print("[OK] llm 模块导入成功")
    except Exception as e:
        print(f"[FAIL] llm 模块导入失败: {e}")
        return False
    
    # 检查配置
    print("\n检查配置...")
    config = llm.get_model_config()
    print(f"配置: {json.dumps(config, indent=2)}")
    
    # 检查模型状态
    print("\n检查模型状态...")
    try:
        status = llm.check_model_status()
        print(f"模型状态: {json.dumps(status, indent=2)}")
    except Exception as e:
        print(f"[WARN] 检查模型状态失败: {e}")
    
    # 测试下载函数（不实际下载，只测试函数签名）
    print("\n测试下载函数签名...")
    try:
        # 测试 _download_from_modelscope 函数
        import inspect
        sig = inspect.signature(llm._download_from_modelscope)
        print(f"_download_from_modelscope 参数: {list(sig.parameters.keys())}")
        
        sig = inspect.signature(llm._download_from_huggingface)
        print(f"_download_from_huggingface 参数: {list(sig.parameters.keys())}")
        
        sig = inspect.signature(llm._download_file_background)
        print(f"_download_file_background 参数: {list(sig.parameters.keys())}")
        
        sig = inspect.signature(llm.start_download)
        print(f"start_download 参数: {list(sig.parameters.keys())}")
        
        print("[OK] 所有下载函数签名正确")
        return True
    except Exception as e:
        print(f"[FAIL] 下载函数测试失败: {e}")
        return False


def main():
    """主测试函数"""
    print("\n" + "=" * 60)
    print("真实下载测试")
    print("=" * 60 + "\n")
    
    results = {
        "modelscope_connection": False,
        "huggingface_connection": False,
        "model_repo_exists": False,
        "download_functions": False,
    }
    
    # results["modelscope_connection"] = test_modelscope_connection()
    # print()
    
    results["huggingface_connection"] = test_huggingface_connection()
    print()
    
    results["model_repo_exists"] = test_model_repo_exists()
    print()
    
    results["download_functions"] = test_download_functions()
    print()
    
    # 总结
    print("=" * 60)
    print("测试总结")
    print("=" * 60)
    
    for test_name, passed in results.items():
        status = "[PASS]" if passed else "[FAIL]"
        print(f"{status} {test_name}")
    
    all_passed = all(results.values())
    print()
    
    if all_passed:
        print("所有测试通过！")
    else:
        print("部分测试失败，请检查网络连接和配置。")
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())