"""Index Cube.js metadata into Milvus for semantic search.

Usage:
    cd backend
    python -m scripts.index_metadata

Fetches all measures and dimensions from the Cube.js REST API,
generates embeddings, and upserts them into the local Milvus instance.
"""

import asyncio
import sys

from src.cube.client import CubeClient
from src.metadata.vector_store import MilvusVectorStore


def build_documents_from_meta(cubes) -> list[dict]:
    """Convert CubeMeta objects into documents for vector indexing."""
    documents = []

    for cube in cubes:
        for measure in cube.measures:
            name = measure.get("name", "") if isinstance(measure, dict) else measure.name
            title = measure.get("title", "") if isinstance(measure, dict) else measure.title
            m_type = measure.get("type", "") if isinstance(measure, dict) else measure.type
            desc = measure.get("description", "") if isinstance(measure, dict) else getattr(measure, "description", "")

            text = f"Measure: {title} ({m_type}) in cube {cube.title}."
            if desc:
                text += f" {desc}"

            documents.append({
                "id": name or f"{cube.name}.{title}",
                "cube_name": cube.name,
                "member_name": name.split(".")[-1] if "." in name else name,
                "member_type": "measure",
                "text": text,
            })

        for dimension in cube.dimensions:
            name = dimension.get("name", "") if isinstance(dimension, dict) else dimension.name
            title = dimension.get("title", "") if isinstance(dimension, dict) else dimension.title
            d_type = dimension.get("type", "") if isinstance(dimension, dict) else dimension.type
            desc = dimension.get("description", "") if isinstance(dimension, dict) else getattr(dimension, "description", "")

            text = f"Dimension: {title} ({d_type}) in cube {cube.title}."
            if desc:
                text += f" {desc}"

            documents.append({
                "id": name or f"{cube.name}.{title}",
                "cube_name": cube.name,
                "member_name": name.split(".")[-1] if "." in name else name,
                "member_type": "dimension",
                "text": text,
            })

    return documents


async def main():
    print("=" * 60)
    print("Cube.js Metadata → Milvus Indexer")
    print("=" * 60)

    # 1. Fetch metadata from Cube.js
    cube_client = CubeClient()
    print("\n[1/3] Fetching metadata from Cube.js API...")
    try:
        cubes = await cube_client.get_meta()
    except Exception as e:
        print(f"  ERROR: Could not connect to Cube.js: {e}")
        print("  Make sure Cube.js is running at the configured URL.")
        sys.exit(1)

    print(f"  Found {len(cubes)} cube(s):")
    for cube in cubes:
        n_measures = len(cube.measures)
        n_dims = len(cube.dimensions)
        print(f"    - {cube.name}: {n_measures} measures, {n_dims} dimensions")

    # 2. Build documents
    print("\n[2/3] Building document embeddings...")
    documents = build_documents_from_meta(cubes)
    print(f"  Generated {len(documents)} documents")

    if not documents:
        print("  No documents to index. Check your Cube.js schema.")
        sys.exit(0)

    # 3. Upsert into Milvus
    print("\n[3/3] Upserting into Milvus...")
    vector_store = MilvusVectorStore()
    vector_store.drop_collection()  # Fresh re-index
    count = vector_store.upsert(documents)
    print(f"  Indexed {count} documents into Milvus")

    # Verify
    total = vector_store.count()
    print(f"\n✓ Done. Collection has {total} documents total.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
