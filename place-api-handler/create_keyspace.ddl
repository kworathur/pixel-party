CREATE KEYSPACE place 
    WITH REPLICATION = {
        'class' : 'SimpleStrategy',
        'replication_factor': 1
    };

CREATE TABLE place.boards (
    id int PRIMARY KEY);

CREATE TABLE place.board_cells (
    board_id int, 
    cell text, 
    data text,
    PRIMARY KEY(board_id, cell)
);


CREATE TABLE place.cooldowns(
    userid text PRIMARY KEY,
    last_action int);
