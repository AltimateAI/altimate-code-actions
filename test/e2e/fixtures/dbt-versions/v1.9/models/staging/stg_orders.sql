-- v1.9: microbatch incremental strategy
{{
    config(
        materialized='incremental',
        incremental_strategy='microbatch',
        event_time='order_date',
        begin='2023-01-01',
        batch_size='day',
        lookback=3
    )
}}

with source as (
    select * from {{ source('raw', 'orders') }}
),

renamed as (
    select
        id as order_id,
        user_id as customer_id,
        order_date,
        status as order_status,
        _etl_loaded_at as loaded_at
    from source
)

select * from renamed
