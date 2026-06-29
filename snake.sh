#!/bin/bash

# Snake Game in Bash
# Use arrow keys or WASD to move. Press 'q' to quit.

# Game settings
WIDTH=40
HEIGHT=20
SNAKE_CHAR="O"
FOOD_CHAR="X"
EMPTY_CHAR=" "

# Initial state
snake_x=10
snake_y=10
snake_body_x=(10)
snake_body_y=(10)
food_x=$((RANDOM % WIDTH))
food_y=$((RANDOM % HEIGHT))
direction="RIGHT" # RIGHT, LEFT, UP, DOWN
score=0
game_over=false

# Hide cursor and cleanup on exit
trap "tput cnorm; clear; exit" SIGINT SIGTERM
tput civis

# Function to draw the board
draw_board() {
    # Clear screen using an ANSI escape code for faster rendering
    printf "\033[H"
    
    # Top border
    printf "┌"
    for ((i=0; i<WIDTH; i++)); do printf "─"; done
    printf "┐\n"

    for ((y=0; y<HEIGHT; y++)); do
        printf "│"
        for ((x=0; x<WIDTH; x++)); do
            # Draw food
            if [[ $x -eq $food_x && $y -eq $food_y ]]; then
                printf "$FOOD_CHAR"
            else
                # Draw snake body
                is_body=false
                for i in "${!snake_body_x[@]}"; do
                    if [[ ${snake_body_x[$i]} -eq $x && ${snake_body_y[$i]} -eq $y ]]; then
                        printf "$SNAKE_CHAR"
                        is_body=true
                        break
                    fi
                done
                if [ "$is_body" = false ]; then
                    printf "$EMPTY_CHAR"
                fi
            fi
        done
        printf "│\n"
    done

    # Bottom border
    printf "└"
    for ((i=0; i<WIDTH; i++)); do printf "─"; done
    printf "┘\n"
    printf "Score: %d  | Use WASD/Arrows to move, Q to quit\n" "$score"
}

# Input handling (non-blocking)
handle_input() {
    read -s -n 1 -t 0.1 key
    case "$key" in
        w|A) # 'w' or Up Arrow (Up Arrow is often \e[A)
            [[ "$direction" != "DOWN" ]] && direction="UP"
            ;;
        s|B) # 's' or Down Arrow
            [[ "$direction" != "UP" ]] && direction="DOWN"
            ;;
        a|D) # 'a' or Left Arrow
            [[ "$direction" != "RIGHT" ]] && direction="LEFT"
            ;;
        d|C) # 'd' or Right Arrow
            [[ "$direction" != "LEFT" ]] && direction="RIGHT"
            ;;
        q)
            game_over=true
            ;;
    esac

    # Special handling for ANSI escape sequences (Arrow keys)
    if [[ "$key" == $'\e' ]]; then
        read -s -n 2 -t 0.1 esc_seq
        case "$esc_seq" in
            "[A") [[ "$direction" != "DOWN" ]] && direction="UP" ;;
            "[B") [[ "$direction" != "UP" ]] && direction="DOWN" ;;
            "[C") [[ "$direction" != "LEFT" ]] && direction="RIGHT" ;;
            "[D") [[ "$direction" != "RIGHT" ]] && direction="LEFT" ;;
        esac
    fi
}

# Main game loop
clear
while [ "$game_over" = false ]; do
    handle_input

    # Update position
    case "$direction" in
        UP) ((snake_y--)) ;;
        DOWN) ((snake_y++)) ;;
        LEFT) ((snake_x--)) ;;
        RIGHT) ((snake_x++)) ;;
    esac

    # Collision with walls
    if [[ $snake_x -lt 0 || $snake_x -ge $WIDTH || $snake_y -lt 0 || $snake_y -ge $HEIGHT ]]; then
        game_over=true
    fi

    # Collision with self
    for i in "${!snake_body_x[@]}"; do
        if [[ ${snake_body_x[$i]} -eq $snake_x && ${snake_body_y[$i]} -eq $snake_y ]]; then
            game_over=true
        fi
    done

    # Check if food eaten
    if [[ $snake_x -eq $food_x && $snake_y -eq $food_y ]]; then
        ((score++))
        # Generate new food
        food_x=$((RANDOM % WIDTH))
        food_y=$((RANDOM % HEIGHT))
        # Keep snake length (don't pop the tail)
    else
        # Move tail: remove last element
        unset 'snake_body_x[${#snake_body_x[@]}-1]'
        unset 'snake_body_y[${#snake_body_y[@]}-1]'
    fi

    # Add new head to body
    snake_body_x+=($snake_x)
    snake_body_y+=($snake_y)

    draw_board
done

tput cnorm
echo "GAME OVER! Final Score: $score"
